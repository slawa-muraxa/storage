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

  async updateBucketData(bucketData: { bucket: string; objects: any[] }[]) {
    for (const { bucket, objects } of bucketData) {
      const sObjectModel = this.getModelForBucket(bucket);

      // Insert or update objects in the respective bucket collection
      await Promise.all(
        objects.map(async (object) => {
          await sObjectModel.updateOne(
            { id: object.name }, // Use a unique identifier for the object
            { ...object, bucket }, // Include bucket info for tracking
            { upsert: true } // Create the object if it doesn't exist
          );
        })
      );
    }
  }

  async getAllActiveObjects(): Promise<any[]> {
    try {
      // Fetch all collection names from the database
      const collections = await this.connection.db.listCollections().toArray();

      // Filter collections that match the bucket pattern
      const bucketCollections = collections.filter((collection) =>
        collection.name.startsWith('storage.') && collection.name.endsWith('.objects')
      );

      // Iterate over each collection and fetch active objects
      const activeObjects = await Promise.all(
        bucketCollections.map(async (collection) => {
          const model = this.connection.model<SObject>(
            collection.name,
            SObjectSchema,
            collection.name
          );
          return model.find({ active: true }); // Query for active objects
        })
      );

      // Flatten the results and return all active objects
      return activeObjects.flat();
    } catch (err) {
      this.logger.error('Error fetching active objects', err);
      throw err;
    }
  }

  async storeVideoMetadata(bucket: string, objectName: string, metadata: any): Promise<any> {
    try {
      // Get the model for the specified bucket
      const sObjectModel = this.getModelForBucket(bucket);

      // Find the object by name and update its metadata
      const result = await sObjectModel.findOneAndUpdate(
        { name: objectName }, // Query by object name
        { $set: { 'metadata.video': metadata } }, // Update the metadata field
        { new: true, upsert: false } // Return the updated document, do not create if it doesn't exist
      );

      // If the object does not exist, log a warning and return null
      if (!result) {
        this.logger.warn(`Object with name "${objectName}" not found in bucket "${bucket}".`);
        return null;
      }

      return result;
    } catch (err) {
      this.logger.error(`Error storing metadata for object "${objectName}" in bucket "${bucket}"`, err);
      throw err;
    }
  }

  async updateObjectTargets(
    bucket: string,
    objectName: string,
    target: { globalId: string; selections: any }
  ): Promise<any> {
    try {
      // Get the model for the specified bucket
      const sObjectModel = this.getModelForBucket(bucket);

      // Find the object to check if the globalId already exists
      const updatedObject = await sObjectModel.findOne({ id: objectName });

      if (updatedObject) {
        // Check if the globalId already exists in the metadata.targets array
        const existingTarget = updatedObject.metadata?.targets?.find(
          (t: { globalId: string }) => t.globalId === target.globalId
        );

        // If the globalId is the same, do not push a new target
        if (existingTarget) {
          this.logger.warn(
            `Target with globalId "${target.globalId}" already exists for object "${objectName}".`
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

  // New tagObject method
  async tagObject(
    bucket: string,
    objectName: string,
    tags: { name: string; time?: string; color?: string }[]
  ): Promise<any> {
    try {
      const sObjectModel = this.getModelForBucket(bucket);
  
      // Find the object by name
      const existingObject = await sObjectModel.findOne({ name: objectName });
  
      if (!existingObject) {
        this.logger.warn(`Object with name "${objectName}" not found in bucket "${bucket}".`);
        return null;
      }
  
      const existingTags = existingObject?.metadata?.tags || [];
  
      // Merge tags based on unique `name`
      const tagMap = new Map<string, { name: string; time?: string; color?: string }>();
  
      // Add existing tags to the map
      for (const tag of existingTags) {
        tagMap.set(tag.name, tag);
      }
  
      // Update or add new tags
      for (const tag of tags) {
        tagMap.set(tag.name, { ...tagMap.get(tag.name), ...tag });
      }
  
      const updatedTags = Array.from(tagMap.values());
  
      const updatedObject = await sObjectModel.findOneAndUpdate(
        { name: objectName },
        { $set: { 'metadata.tags': updatedTags } },
        { new: true }
      );
  
      return updatedObject;
    } catch (err) {
      this.logger.error(`Error adding tags to object "${objectName}" in bucket "${bucket}".`, err);
      throw err;
    }
  }  

}