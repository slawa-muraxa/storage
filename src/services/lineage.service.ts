import { Injectable, Logger } from '@nestjs/common';
import { Model, Connection } from 'mongoose';
import { SObject, SObjectSchema } from '../schemas/sobject.schema'; // Assuming you have an ObjectData schema
import { InjectConnection } from '@nestjs/mongoose';

@Injectable()
export class StorageService {

  private readonly logger = new Logger(StorageService.name);
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


  async updateObjectTargets(
    bucket: string,
    objectName: string,
    target: { serviceName: ServiceName; trackingId: string; references: any }
  ): Promise<any> {
    try {
      // Get the model for the specified bucket
      const sObjectModel = this.getModelForBucket(bucket);

      // Find the object to check if the globalId already exists
      const updatedObject = await sObjectModel.findOne({ id: objectName });

      if (updatedObject) {
        // Check if the globalId already exists in the metadata.targets array
        const existingTarget = updatedObject.metadata?.targets?.find(
          (t: { trackingId: string }) => t.trackingId === target.trackingId
        );

        // If the globalId is the same, do not push a new target
        if (existingTarget) {
          this.logger.warn(
            `Target with tracking id "${target.trackingId}" already exists for object "${objectName}".`
          );
          return updatedObject; // Return the existing object without any changes
        }

        // Proceed with the $push if globalId is different
        const result = await sObjectModel.findOneAndUpdate(
          { id: objectName }, // Query by object ID
          {
            $push: { 'metadata.targets': target }, // Append the new target to the targets array
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

}