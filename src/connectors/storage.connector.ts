import { Readable } from "stream";

export interface StorageConnector {
    downloadFile(bucketName: string, objectName: string, filePath: string): Promise<string>;
    getObject(bucketName: string, objectName: string): Promise<Readable>;
    putObject(bucketName: string, targetFilePath: string, fullPath: string, metadata?: Record<string, any>): Promise<any> 
    uploadFile(bucketName: string, objectName: string, filePath: string, metadata?: Record<string, any>): Promise<string>;
    checkAndCreateBuckets(): Promise<void>;
    listAllObjects(bucketName: string, path: string): Promise<any[]>;
    removeObject(bucket: string, name: string): Promise<void>;
    acquireLock(): Promise<boolean>;
    releaseLock(): Promise<void>;
    getPartialObject(bucketName: string, objectName: string, offset: number, length: number, getOpts?: object): Promise<Readable>;
    getObjectStats(bucketName: string, objectName: string): Promise<{size: number}>;
}