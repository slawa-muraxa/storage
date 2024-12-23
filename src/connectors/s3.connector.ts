import { Injectable, Inject, Logger } from '@nestjs/common';
import {
    S3Client,
    GetObjectCommand,
    PutObjectCommand,
    ListObjectsV2Command,
    HeadObjectCommand,
    DeleteObjectCommand,
    CreateBucketCommand,
    HeadBucketCommand,
} from '@aws-sdk/client-s3';
import { Readable } from 'stream';
import { promises as fs, createWriteStream } from 'fs';
import { StorageConnector } from './storage.connector';
import * as path from 'path';

@Injectable()
export class S3Connector implements StorageConnector {
    private readonly logger = new Logger(S3Connector.name);
    private readonly lockKey: string = 'default-lock-key';

    constructor(
        @Inject('S3_CLIENT') private readonly s3Client: S3Client,
    ) {}

    async getPartialObject(bucketName: string, objectName: string, offset: number, length: number, getOpts: object = {}): Promise<Readable> {
        try {
            const command = new GetObjectCommand({
                Bucket: bucketName,
                Key: objectName,
                Range: `bytes=${offset}-${offset + length - 1}`,
                ...getOpts
            });

            const response = await this.s3Client.send(command);
            this.logger.log(`Successfully fetched partial object from ${bucketName}/${objectName} at range ${offset}-${offset + length - 1}`);
            return response.Body as Readable;
        } catch (err) {
            this.logger.error(`Error fetching partial object from ${bucketName}/${objectName} at range ${offset}-${offset + length - 1}:`, err);
            throw err;
        }
    }

    async putObject(
        bucketName: string,
        targetFilePath: string,
        fullPath: string,
        metadata: Record<string, any>
    ): Promise<string> {
        try {
            // Read the file from the provided full path
            const fileContent = await fs.readFile(fullPath);
    
            // Create the PutObjectCommand
            const command = new PutObjectCommand({
                Bucket: bucketName,
                Key: targetFilePath,
                Body: fileContent,
                Metadata: metadata,
            });
    
            // Send the command to S3
            const response = await this.s3Client.send(command);
    
            // Log success and return the ETag as confirmation
            this.logger.log(`Successfully uploaded object to ${bucketName}/${targetFilePath}`);
            return response.ETag || '';
        } catch (err) {
            // Log and re-throw errors for handling upstream
            this.logger.error(
                `Error uploading object to ${bucketName}/${targetFilePath}:`,
                err
            );
            throw err;
        }
    }

    async acquireLock(): Promise<boolean> {
        const lockObject = `locks/${this.lockKey}`;
        const bucketName = 'l1-raw'; // Or configure a dedicated lock bucket.
    
        try {
            const command = new PutObjectCommand({
                Bucket: bucketName,
                Key: lockObject,
                Body: 'LOCK',
                ContentType: 'text/plain',
                Metadata: { createdAt: new Date().toISOString() },
                // This ensures the object is only uploaded if it does not already exist
                IfNoneMatch: '*',
            });
    
            await this.s3Client.send(command);
            return true;
        } catch (err) {
            if (err.name === 'PreconditionFailed') {
                this.logger.warn(`Lock already exists: ${lockObject}`);
                return false; // Lock already held
            }
    
            this.logger.error(`Error acquiring lock: ${lockObject}`, err);
            throw err; // Other unexpected errors
        }
    }
    
    async releaseLock(): Promise<void> {
        const lockObject = `locks/${this.lockKey}`;
        const bucketName = 'l1-raw'; // Or configure a dedicated lock bucket.
    
        try {
            const command = new DeleteObjectCommand({
                Bucket: bucketName,
                Key: lockObject,
            });
    
            await this.s3Client.send(command);
        } catch (err) {
            this.logger.error(`Error releasing lock: ${lockObject}`, err);
            throw err;
        }
    }

    async downloadFile(bucketName: string, objectName: string, filePath: string): Promise<string> {
        try {
            const command = new GetObjectCommand({ Bucket: bucketName, Key: objectName });
            const response = await this.s3Client.send(command);
    
            const fileStream = response.Body as Readable;
    
            // Ensure the directory exists before attempting to write the file
            await fs.mkdir(path.dirname(filePath), { recursive: true });
    
            const writeStream = createWriteStream(filePath);
    
            await new Promise<void>((resolve, reject) => {
                fileStream.pipe(writeStream)
                    .on('finish', resolve)
                    .on('error', reject);
            });
    
            this.logger.log(`Successfully downloaded ${objectName} from S3 bucket ${bucketName} to ${filePath}`);
            return filePath;
        } catch (err) {
            this.logger.error(`Error downloading ${objectName} from S3 bucket ${bucketName}:`, err);
            throw err;
        }
    }

    async uploadFile(bucketName: string, objectName: string, filePath: string, metadata: Record<string, any> = {}): Promise<string> {
        try {
            const fileContent = await fs.readFile(filePath);
            const command = new PutObjectCommand({
                Bucket: bucketName,
                Key: objectName,
                Body: fileContent,
                Metadata: metadata,
            });
            const response = await this.s3Client.send(command);

            this.logger.log(`Successfully uploaded ${filePath} to ${bucketName}/${objectName}`);
            return response.ETag || '';
        } catch (err) {
            this.logger.error(`Error uploading ${filePath} to S3 bucket ${bucketName}:`, err);
            throw err;
        }
    }

    async checkAndCreateBuckets(): Promise<void> {
        const buckets = ['l1-raw', 'l2-prep', 'l3-rel', 'l4-dl'];

        for (const bucket of buckets) {
            try {
                const headBucketCommand = new HeadBucketCommand({ Bucket: bucket });
                await this.s3Client.send(headBucketCommand);
                this.logger.log(`Bucket ${bucket} already exists`);
            } catch {
                const createBucketCommand = new CreateBucketCommand({ Bucket: bucket });
                await this.s3Client.send(createBucketCommand);
                this.logger.log(`Bucket ${bucket} created`);
            }
        }
    }

    async getObjectStats(bucketName: string, objectName: string): Promise<{size: number}> {
        try {
            const command = new HeadObjectCommand({ Bucket: bucketName, Key: objectName });
            const response = await this.s3Client.send(command);

            this.logger.log(`Successfully fetched stats for ${objectName} from bucket ${bucketName}`);
            return {size: response.ContentLength};
        } catch (err) {
            this.logger.error(`Error fetching stats for ${objectName} from S3 bucket ${bucketName}:`, err);
            throw err;
        }
    }

    async getObject(bucketName: string, objectName: string): Promise<Readable> {
        try {
            const command = new GetObjectCommand({ Bucket: bucketName, Key: objectName });
            const response = await this.s3Client.send(command);

            this.logger.log(`Successfully fetched the full object ${objectName} from bucket ${bucketName}`);
            return response.Body as Readable;
        } catch (err) {
            this.logger.error(`Error fetching the full object ${objectName} from S3 bucket ${bucketName}:`, err);
            throw err;
        }
    }

    async listAllObjects(bucketName: string, path: string): Promise<any[]> {
        try {
            const objects: any = [];
            let continuationToken: string | undefined = undefined;
    
            do {
                const command = new ListObjectsV2Command({
                    Bucket: bucketName,
                    Prefix: path,
                    ContinuationToken: continuationToken,
                });
                const response = await this.s3Client.send(command);
    
                // Map each object to SObject schema-compatible structure
                const mappedObjects = (response.Contents || []).map((obj) => {
                    return {
                        id: obj.Key,
                        name: obj.Key,
                        etag: obj.ETag.replace(/"/g, ''),
                        size: obj.Size,
                        lastModified: obj.LastModified,
                        active: true,
                        metadata: {}, 
                    };
                });
    
                objects.push(...mappedObjects);
                continuationToken = response.NextContinuationToken;
            } while (continuationToken);
    
            this.logger.log(`Successfully fetched all objects from bucket ${bucketName}`);
            return objects;
        } catch (err) {
            this.logger.error(`Error listing objects in bucket ${bucketName}:`, err);
            throw err;
        }
    }

    async removeObject(bucketName: string, objectName: string): Promise<void> {
        try {
            const command = new DeleteObjectCommand({ Bucket: bucketName, Key: objectName });
            await this.s3Client.send(command);

            this.logger.log(`Object ${objectName} removed from ${bucketName}`);
        } catch (err) {
            this.logger.error(`Error removing object ${objectName} from ${bucketName}`, err);
            throw err;
        }
    }

    async testMinioConnection(): Promise<void> {
        try {
            const command = new ListObjectsV2Command({ Bucket: 'some-bucket' });
            await this.s3Client.send(command);

            this.logger.log('S3 connection successful.');
        } catch (error) {
            this.logger.error('Error connecting to S3:', error);
        }
    }
}