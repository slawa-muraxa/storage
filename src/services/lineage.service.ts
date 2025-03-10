import { Injectable, Logger } from '@nestjs/common';
import { Model, Connection } from 'mongoose';
import { SObject, SObjectSchema, ServiceName } from '../schemas/sobject.schema'; // Assuming you have an ObjectData schema
import { InjectConnection } from '@nestjs/mongoose';

const ServiceDetails: Record<ServiceName, { bucket: string }> = {
  [ServiceName.ENOT]: { bucket: undefined },
  [ServiceName.STORAGE_PREVIEW]: { bucket: 'l1-preview' },
  [ServiceName.STORAGE_VERSION]: { bucket: 'l1-raw' },
  [ServiceName.STORAGE_LAKE]: { bucket: "l4-dl" },
  [ServiceName.STORAGE_DATASET]: { bucket: "l3-rel" },
};

// Define enum before usage
export enum LinkType {
  SOURCE = "sources",
  TARGET = "targets"
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