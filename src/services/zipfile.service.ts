import { Inject, Injectable, Logger } from '@nestjs/common';
import { StorageConnector } from '../connectors/storage.connector';
import { KafkaConnector } from '../connectors/kafka.connector';
import * as unzipper from 'unzipper';
import * as path from 'path';
import * as fs from 'fs';
import { Cron, CronExpression } from '@nestjs/schedule';

@Injectable()
export class ZipFileProcessorService {

    private readonly logger = new Logger(ZipFileProcessorService.name);

    private readonly bucket = 'l4-dl';

    constructor(
        @Inject('StorageConnector') private readonly storage: StorageConnector,
        private readonly kafka: KafkaConnector,
    ) { }

    private async unzipFile(fileStream: NodeJS.ReadableStream, targetDir: string): Promise<void> {
        // Unzip the file stream and store it in a temporary directory
        await fileStream.pipe(unzipper.Extract({ path: targetDir })).promise();
        this.logger.log(`Unzipped content to ${targetDir}`);
    }

    private async uploadUnzippedContentToL4(localPath: string, dstPath: string): Promise<void> {
        // Upload each unzipped file to the l4-dl bucket
        const files = await this.getFilesInDirectory(localPath, dstPath); // Helper to list files
        for (const file of files) {
            const filePath = path.join(localPath, file.relativePath);
            // Check if the file is 'default.json'
            if (file.relativePath === 'annotations/default.json') {
                // Read and parse the content of default.json
                const jsonContent = await this.readJsonFile(filePath);
                // Store or process the parsed JSON as needed
                this.logger.log('Parsed default.json:', jsonContent);
                file.content = jsonContent;

            } 
            await this.storage.uploadFile(this.bucket, file.targetPath, filePath);
            await this.kafka.publishAnnotationUpdate(file);
            this.logger.log(`Uploaded ${filePath} to l4-dl/${file.targetPath}`);
        }
    }

    // Helper function to read and parse a JSON file
    private async readJsonFile(filePath: string): Promise<any> {
        return new Promise((resolve, reject) => {
            fs.readFile(filePath, 'utf8', (err, data) => {
                if (err) {
                    reject(err);
                } else {
                    try {
                        const jsonData = JSON.parse(data);
                        resolve(jsonData);
                    } catch (parseError) {
                        reject(parseError);
                    }
                }
            });
        });
    }

    private async getFilesInDirectory(dir: string, dstPath: string): Promise<any[]> {
        const files: any[] = [];

        // Helper function to read files recursively
        const readDirectory = (directory: string, basePath: string) => {
            const items = fs.readdirSync(directory); // Synchronously read contents of the directory

            items.forEach((item) => {
                const itemPath = path.join(directory, item); // Get full path of the item
                const relativePath = path.relative(basePath, itemPath); // Get the relative path

                if (fs.statSync(itemPath).isDirectory()) {
                    // If item is a directory, recurse into it
                    readDirectory(itemPath, basePath);
                } else {
                    const targetPath: string = path.join(dstPath, relativePath);
                    // If item is a file, add its relative path
                    files.push({ targetPath, relativePath, dstPath, bucket: this.bucket });
                }
            });
        };

        // Start the recursion from the given directory
        if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) {
            readDirectory(dir, dir);
        } else {
            throw new Error(`The provided path is not a valid directory: ${dir}`);
        }

        return files;
    }

    @Cron(CronExpression.EVERY_10_SECONDS)
    async checkNewZipFiles(): Promise<void> {
        // Ensure the lock is acquired before processing
        const lockAcquired = await this.storage.acquireLock();
        if (!lockAcquired) return;

        try {
            const objects = await this.storage.listAllObjects('l2-prep', 'annotations/');
            for (const obj of objects) {
                if (obj.name.endsWith('.zip')) {
                    this.logger.log(`New zip file detected: ${obj.name}`);
                    // Download the zip file
                    const fileStream = await this.storage.getObject('l2-prep', obj.name);

                    // Decode filename into the target path (e.g., test---file.zip -> test/file)
                    const fileName = path.basename(obj.name, '.zip');
                    const decodedPath = fileName.replace(/---/g, '/');
                    const tempDir = '/tmp/unzipped-content'; // Temp directory to unzip content

                    // Unzip the content to the temp directory
                    await this.unzipFile(fileStream, tempDir);

                    // Upload the unzipped content to the l4-dl bucket
                    await this.uploadUnzippedContentToL4(tempDir, `${decodedPath}`);

                    // Remove the processed object from l2-prep bucket
                    await this.storage.removeObject('l2-prep', obj.name);
                    this.logger.log(`Processed and removed ${obj.name} from l2-prep`);
                }
            }
        } catch (err) {
            this.logger.error('Error checking or processing zip files:', err);
        } finally {
            // Release the lock
            await this.storage.releaseLock();
        }
    }
}