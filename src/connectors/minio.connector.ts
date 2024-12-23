import { Injectable, Inject, Logger } from '@nestjs/common';
import { Client as MinioClient } from 'minio';
import { StorageConnector } from './storage.connector';
import { Readable } from 'stream';

@Injectable()
export class MinioConnector implements StorageConnector {

    private readonly logger = new Logger(MinioConnector.name);

    private readonly lockKey: string = 'default-lock-key';

    constructor(
        @Inject('S3_CLIENT') private readonly minioClient: MinioClient,
    ) { }

    async downloadFile(bucketName: string, objectName: string, filePath: string): Promise<string> {
        try {
            await this.minioClient.fGetObject(bucketName, objectName, filePath);
            this.logger.log(`Successfully downloaded ${objectName} from MinIO bucket ${bucketName} to ${filePath}`);
            return filePath;
        } catch (err) {
            this.logger.error(`Error downloading ${objectName} from MinIO bucket ${bucketName}:`, err);
            throw err;
        }
    }

    async uploadFile(bucketName: string, objectName: string, filePath: string, metadata: Record<string, any> = {}): Promise<string> {
        try {
            // Upload the file from the local filesystem to the specified MinIO bucket
            const result = await this.minioClient.fPutObject(bucketName, objectName, filePath, metadata);

            this.logger.log(`Successfully uploaded ${filePath} to ${bucketName}/${objectName} with ETag: ${result.etag}`);
            return result.etag;  // Return the ETag of the uploaded file
        } catch (err) {
            this.logger.error(`Error uploading ${filePath} to MinIO bucket ${bucketName}:`, err);
            throw err;  // Re-throw the error to be handled by the caller
        }
    }

    async checkAndCreateBuckets(): Promise<void> {
        const buckets = ['l1-raw', 'l2-prep', 'l3-rel', 'l4-dl'];

        for (const bucket of buckets) {
            try {
                const bucketExists = await this.minioClient.bucketExists(bucket);
                if (!bucketExists) {
                    await this.minioClient.makeBucket(bucket, 'local-1');
                    this.logger.log(`Bucket ${bucket} created`);
                } else {
                    this.logger.log(`Bucket ${bucket} already exists`);
                }
            } catch (error) {
                this.logger.error(`Error checking/creating bucket ${bucket}:`, error);
            }
        }
    }

    // New function to get object stats (size, last modified, etc.)
    async getObjectStats(bucketName: string, objectName: string): Promise<any> {
        try {
            const stats = await this.minioClient.statObject(bucketName, objectName);
            this.logger.log(`Successfully fetched stats for ${objectName} from bucket ${bucketName}`);
            return stats;  // Returns stats including size, last modified, and more
        } catch (err) {
            this.logger.error(`Error fetching stats for ${objectName} from MinIO bucket ${bucketName}:`, err);
            throw err;
        }
    }

    // Fetch full object as a data stream
    async getObject(bucketName: string, objectName: string): Promise<Readable> {
        try {
            const dataStream = await this.minioClient.getObject(bucketName, objectName);
            this.logger.log(`Successfully fetched the full object ${objectName} from bucket ${bucketName}`);
            return dataStream as Readable;
        } catch (err) {
            this.logger.error(`Error fetching the full object ${objectName} from MinIO bucket ${bucketName}:`, err);
            throw err;
        }
    }

    async getPartialObject(bucketName: string, objectName: string, offset: number, length: number, getOpts: object = {}): Promise<Readable> {
        try {
            // Use MinIO's getPartialObject API to fetch a part of the object starting from 'offset' and with a given 'length'
            const dataStream = await this.minioClient.getPartialObject(bucketName, objectName, offset, length, getOpts);

            this.logger.log(`Successfully fetched partial object ${objectName} from bucket ${bucketName}, offset: ${offset}, length: ${length}`);
            return dataStream as Readable;
        } catch (err) {
            this.logger.error(`Error fetching partial object ${objectName} from MinIO bucket ${bucketName}:`, err);
            throw err;
        }
    }

    // New method to list all objects in a specified bucket
    async listAllObjects(bucketName: string, path: string): Promise<any[]> {
        try {
            const objects = [];
            const stream = this.minioClient.listObjectsV2(bucketName, path, true);

            return new Promise((resolve, reject) => {
                stream.on('data', (obj) => {
                    objects.push(obj); // Collect each object from the stream
                });
                stream.on('end', () => {
                    this.logger.log(`Successfully fetched all objects from bucket ${bucketName}`);
                    resolve(objects); // Return all collected objects once the stream ends
                });
                stream.on('error', (err) => {
                    this.logger.error(`Error listing objects from bucket ${bucketName}:`, err);
                    reject(err); // Reject the promise in case of an error
                });
            });
        } catch (err) {
            this.logger.error(`Error listing objects in bucket ${bucketName}:`, err);
            throw err; // Throw the error if anything goes wrong
        }
    }

    async putObject(bucketName: string, targetFilePath: string, fullPath: string, metadata: Record<string, any> = {}): Promise<any> {
        try {
            const info = await this.minioClient.fPutObject(bucketName, targetFilePath, fullPath, metadata);
            this.logger.log(`Uploaded ${fullPath} to ${bucketName}/${targetFilePath} with ETag: ${info.etag}`);
            return info;
        } catch (err) {
            this.logger.error(`Error uploading ${fullPath} to ${bucketName}/${targetFilePath}:`, err);
            throw err;
        }
    }

    async testMinioConnection(): Promise<void> {
        try {
            const buckets = await this.minioClient.listBuckets();
            this.logger.log(`MinIO connection successful. Buckets: ${buckets.map((b) => b.name).join(', ')}`);
        } catch (error) {
            this.logger.error('Error connecting to MinIO:', error);
        }
    }

    async acquireLock(): Promise<boolean> {
        // Try to create a lock file for atomic operation
        try {
            const lockExists = await this.minioClient.statObject('locks', this.lockKey).catch(() => null);
            if (lockExists) {
                this.logger.warn('Lock already acquired by another process');
                return false;
            }

            // Create lock to prevent other processes from executing concurrently
            await this.obtainLock();
            return true;
        } catch (err) {
            this.logger.error('Error acquiring lock:', err);
            return false;
        }
    }

    // Wrapper to obtain a lock by placing a "locked" object in the 'locks' bucket
    private async obtainLock(): Promise<void> {
        try {
            await this.minioClient.putObject('l2-prep', this.lockKey, Buffer.from('locked'));
        } catch (err) {
            this.logger.error(`Error obtaining lock for ${this.lockKey}:`, err);
            throw err;
        }
    }

    // Wrapper to release the lock by removing the lock object from the 'locks' bucket
    async releaseLock(): Promise<void> {
        try {
            await this.minioClient.removeObject('l2-prep', this.lockKey);
        } catch (err) {
            this.logger.error(`Error releasing lock for ${this.lockKey}:`, err);
            throw err;
        }
    }

    // Wrapper to remove an object from the 'l2-prep' bucket
    async removeObject(bucket: string, name: string): Promise<void> {
        try {
            await this.minioClient.removeObject(bucket, name);
            this.logger.log(`Object ${name} removed from ${bucket}`);
        } catch (err) {
            this.logger.error(`Error removing object ${name} from ${bucket}`, err);
            throw err;
        }
    }
}