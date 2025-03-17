import { Injectable, Logger } from '@nestjs/common';
import { Model, Connection } from 'mongoose';
import { SObject, SObjectSchema, ServiceName } from '../schemas/sobject.schema'; // Assuming you have an ObjectData schema
import { InjectConnection } from '@nestjs/mongoose';

const ServiceDetails: Record<ServiceName, { bucket: string }> = {
  [ServiceName.ENOT]: { bucket: 'l2-proc' },
  [ServiceName.STORAGE_PREVIEW]: { bucket: 'l1-preview' },
  [ServiceName.STORAGE_VERSION]: { bucket: 'l1-raw' },
  [ServiceName.STORAGE_LAKE]: { bucket: "l4-dl" },
  [ServiceName.STORAGE_DATASET]: { bucket: "l3-rel" },
};

function getServiceNameByBucket(bucket: string): ServiceName | undefined {
  return Object.entries(ServiceDetails).find(([_, details]) => details.bucket === bucket)?.[0] as ServiceName | undefined;
}

// Define enum before usage
export enum LinkType {
  SOURCE = "sources",
  TARGET = "targets"
}

function getOppositeLinkType(linkType: LinkType): LinkType {
  return linkType === LinkType.SOURCE ? LinkType.TARGET : LinkType.SOURCE;
}

@Injectable()
export class LineageService {

  private readonly logger = new Logger(LineageService.name);
  private models: Map<string, Model<SObject>> = new Map();

  constructor(@InjectConnection() private readonly connection: Connection) { }

  getModelForBucket(bucket: string): Model<SObject> {
    const collectionName = `storage.${bucket}.objects`;

    // Check if the model already exists
    if (!this.models.has(collectionName)) {
      const model = this.connection.model<SObject>(collectionName, SObjectSchema, collectionName);
      this.models.set(collectionName, model);
    }

    return this.models.get(collectionName);
  }

  async reLinkObject(
    bucket: string,
    objectName: string,
    serviceName: ServiceName,
    reference: string,
    linkType: LinkType // 'sources' or 'targets'
  ): Promise<any> {
    try {
      const lBucket = ServiceDetails[serviceName]?.bucket;

      // Get the model for the specified bucket
      const xObjectModel = this.getModelForBucket(bucket);
      const lObjectModel = this.getModelForBucket(lBucket);

      // Find the object to check if it exists
      const xObject = await xObjectModel.findOne({ id: objectName });

      // Find the object to check if it exists
      const lObject = await lObjectModel.findOne({ id: reference });

      if (xObject && lObject) {
        // Step 1: Cancel existing link of the same ServiceName in the specified linkType ('sources' or 'targets')

        const existingLinkIndex = xObject[linkType]?.findIndex(
          (l: { serviceName: ServiceName }) => l.serviceName === serviceName
        );

        if (existingLinkIndex !== -1) {
          // Remove the existing link of the same ServiceName
          const existingLink = xObject[linkType][existingLinkIndex];
          const { trackingId: oTrackingId, serviceName: oServiceName } = existingLink;
          // Find the associated bucket based on serviceName
          const oBucket = ServiceDetails[oServiceName]?.bucket;
          if (oBucket) {
            const oObjectModel = this.getModelForBucket(oBucket);
            const oObject = await oObjectModel.findOne({ etag: oTrackingId });
            if (oObject) {
              const oLinkType = getOppositeLinkType(linkType);
              // Check if the opposite link exists in the referenced object
              const oLinkIndex = oObject[oLinkType]?.findIndex(
                (l: { trackingId: string }) => l.trackingId === xObject.etag
              );
              if (oLinkIndex !== -1) {
                // Remove the link from the existing object
                oObject[oLinkType].splice(oLinkIndex, 1);
                await oObject.save();

                this.logger.debug(
                  `Removed reciprocal link in ${oLinkType} for object "${oObject.id}" in bucket "${oBucket}"`
                );
              }
            }
            xObject[linkType].splice(existingLinkIndex, 1);
            this.logger.debug(`Removed existing link for service "${serviceName}" in ${linkType}`);
          }
        }

        // Step 2: Create a new link
        const newLink = {
          serviceName,
          trackingId: lObject.etag, // Use appropriate tracking ID logic
          references: { objectName: reference },
        };

        // Add the new link to the correct array (sources or targets)
        xObject[linkType].push(newLink);

        // Save the object with the updated link
        await xObject.save();
        this.logger.debug(`Updated object with new link for service "${serviceName}" in ${linkType}`);


        // Step 3: Update link of the lObject 
        const xServiceName = getServiceNameByBucket(bucket);

        this.updateObjectLink(lBucket, reference, { serviceName: xServiceName, trackingId: xObject.etag, references: { objectName } }, getOppositeLinkType(linkType));
        this.logger.debug(`Updated object with new link for service "${xServiceName}" in ${objectName}`);
        return xObject;
      } else {
        this.logger.debug(`Object with id "${objectName}" or "${reference}" not found.`);
      }
    } catch (err) {
      this.logger.error(
        `Error in reLinkObject for object "${objectName}" in bucket "${bucket}".`,
        err
      );
      throw err;
    }
  }

  async updateObjectLink(
    bucket: string,
    objectName: string,
    link: { serviceName: ServiceName; trackingId: string; references: any },
    linkType: LinkType
  ): Promise<any> {
    try {
      // Get the model for the specified bucket
      const sObjectModel = this.getModelForBucket(bucket);

      // Find the object to check if the globalId already exists
      const updatedObject = await sObjectModel.findOne({ id: objectName });

      if (updatedObject) {
        // Check if the globalId already exists in the metadata.targets array
        const existingLink = updatedObject[linkType]?.find(
          (l: { trackingId: string }) => l.trackingId === link.trackingId
        );

        // If the globalId is the same, do not push a new target
        if (existingLink) {
          this.logger.warn(
            `Target with tracking id "${link.trackingId}" already exists for object "${objectName}".`
          );
          return updatedObject; // Return the existing object without any changes
        }

        // Proceed with the $push if globalId is different
        const result = await sObjectModel.findOneAndUpdate(
          { id: objectName }, // Query by object ID
          {
            $push: { [linkType]: link }, // Append the new target to the targets array
          },
          {
            new: true, // Return the updated document
            upsert: false, // Do not create if the document doesn't exist
          }
        );

        if (!result) {
          this.logger.warn(`Object with id "${objectName}" not found in bucket "${bucket}".`);
        }

        return result;
      } else {
        this.logger.warn(`Object with id "${objectName}" not found in bucket "${bucket}".`);
        return null;
      }
    } catch (err) {
      this.logger.error(
        `Error updating targets for object "${objectName}" in bucket "${bucket}".`,
        err
      );
      throw err;
    }
  }

  async verifyObjectTargets(
    bucket: string,
    objectName: string,
  ): Promise<any> {
    try {
      // Get the model for the specified bucket
      const sObjectModel = this.getModelForBucket(bucket);

      // Find the object to check if the globalId already exists
      const verifiedObject = await sObjectModel.findOne({ id: objectName });

      if (!verifiedObject) {
        this.logger.warn(`Object with id "${objectName}" not found in bucket "${bucket}".`);
        return;
      }

      const trackingIdsToRemove: string[] = [];

      for (const target of verifiedObject.targets || []) {
        const targetBucket = ServiceDetails[target.serviceName]?.bucket;
        if (!targetBucket) continue;

        const targetObjectModel = this.getModelForBucket(targetBucket);
        const targetObject = await targetObjectModel.findOne({ etag: target.trackingId });

        if (!targetObject) {
          trackingIdsToRemove.push(target.trackingId);
        }
      }

      if (trackingIdsToRemove.length > 0) {
        await sObjectModel.findOneAndUpdate(
          { id: objectName }, // Query by object ID
          {
            $pull: {
              'targets': { trackingId: { $in: trackingIdsToRemove } } // Remove matching targets
            }
          },
          {
            new: true, // Return the updated document
            upsert: false, // Do not create if the document doesn't exist
          }
        );
      }
    } catch (err) {
      this.logger.error(
        `Error updating targets for object "${objectName}" in bucket "${bucket}".`,
        err
      );
      throw err;
    }
  }

}