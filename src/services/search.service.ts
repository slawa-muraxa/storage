import { Injectable, Logger } from '@nestjs/common';
import { Model, Connection } from 'mongoose';
import { SObject, SObjectSchema } from '../schemas/sobject.schema'; // Assuming you have an ObjectData schema
import { InjectConnection } from '@nestjs/mongoose';

@Injectable()
export class SearchService {

  private readonly logger = new Logger(SearchService.name);
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

  async getLinkedObjects(bucket: string, objectName: string): Promise<any[]> {
    try {
      // Fetch all collection names from the database
      const collections = await this.connection.db.listCollections().toArray();

      // Filter collections that match the bucket pattern
      const bucketCollections = collections.filter((collection) =>
        collection.name.startsWith('storage.') && collection.name.endsWith('.objects')
      );

      const sObjectModel = this.getModelForBucket(bucket);

      const rootObject = await sObjectModel.findOne(
        { id: objectName }
      );

      // Iterate over each collection and fetch active objects
      const activeObjects = await Promise.all(
        bucketCollections.map(async (collection) => {
          const model = this.connection.model<SObject>(
            collection.name,
            SObjectSchema,
            collection.name
          );
          return model.find({
            '$and': [
              { active: true },
              {
                $or: [
                  { name: objectName }, // Match objects where 'name' is equal to the provided name
                  {
                    targets: {
                      $elemMatch: {
                        trackingId: rootObject.etag
                      }
                    }
                  }, // Match objects where any target contains a reference with 'objectName' equal to the provided name
                  {
                    sources: {
                      $elemMatch: {
                        trackingId: rootObject.etag
                      }
                    }
                  }, // Match objects where any source contains a reference with 'objectName' equal to the provided name
                ]
              }
            ]
          }); // Query for active objects
        })
      );

      // Flatten the results and return all active objects
      return activeObjects.flat();
    } catch (err) {
      this.logger.error('Error fetching active objects', err);
      throw err;
    }
  }

}