import { Controller, Get, Post, Body, Query, Req, Res, UseGuards, UploadedFiles, HttpStatus, UseInterceptors, Logger, Headers, Inject } from '@nestjs/common';
import { StorageConnector } from './connectors/storage.connector';
import { VideoService } from './services/video.service';
import { IngestService } from './services/ingest.service';
import { StorageService } from './services/storage.service';  // Mongo service to interact with your database
import { LineageService, LinkType } from './services/lineage.service';  // Mongo service to interact with your database
import { AuthGuard } from './auth/auth.guard.rpc';  // Auth guard for route protection
import * as fs from 'fs';
import * as path from 'path';
import { format } from 'date-fns';
import { FilesInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { ServiceName, SObject } from './schemas/sobject.schema';

@Controller('api')
export class StorageController {

    private readonly logger = new Logger(StorageController.name);

    constructor(
        @Inject('StorageConnector') private readonly storage: StorageConnector,
        private readonly video: VideoService,
        private readonly db: StorageService,
        private readonly ingest: IngestService,
        private readonly lineage: LineageService,
    ) { }

    @Get('sync-minio-structure')
    @UseGuards(AuthGuard)  // Use the custom auth guard here
    async syncMinioStructure(@Req() req, @Res() res) {
        try {
            console.log('Start syncing MinIO buckets');
            const buckets = [ "l1-raw", "l1-preview", "l2-prep", "l3-rel"];
            const newBucketData = await Promise.all(buckets.map(async (bucket) => {
                await this.db.deactivateObjects(bucket);
                const objects = await this.storage.listAllObjects(bucket, '');
                this.logger.debug(`fetched ${objects.length} objects from ${bucket} for syncing`);
                return { bucket, objects };
            }));

            await this.db.updateBucketData(newBucketData);

            const allObjects = await this.db.getAllActiveObjects();
            const groupedObjects = this.groupByBucket(allObjects);
            return res.json(groupedObjects);
        } catch (err) {
            return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ error: err.message });
        }
    }

    @Get('fetch-minio-structure')
    @UseGuards(AuthGuard)
    async fetchMinioStructure(@Req() req, @Res() res) {
        try {
            const activeData = await this.db.getAllActiveObjects();
            return res.json(this.groupByBucket(activeData));
        } catch (err) {
            return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ error: err.message });
        }
    }

    @Get('stream/l1')
    async streamVideo(
        @Query('fileName') fileName: string,
        @Headers('range') range: string,
        @Res() res
    ) {
        const MAX_CHUNK_SIZE = 30 * 1024 * 1024; // 100 MB

        try {
            this.logger.debug(`Received request to stream file: ${fileName}`);

            const sObject = await this.db.getObject('l1-raw', fileName);
            const previewBucket = sObject?.preview ? "l1-preview" : "l1-raw"; 

            // Get file stats
            const fileStats = await this.storage.getObjectStats(previewBucket, fileName);
            //const fileStats = await this.db.getObject('l1-raw', fileName);
            const fileSize = fileStats.size;
            this.logger.debug(`File size retrieved (${previewBucket}): ${fileSize} bytes`);

            if (range) {
                // Parse the range header
                const parts = range.replace(/bytes=/, '').split('-');
                const start = parseInt(parts[0], 10);
                const end = parts[1]
                    ? Math.min(parseInt(parts[1], 10), fileSize - 1)
                    : Math.min(start + MAX_CHUNK_SIZE - 1, fileSize - 1);

                if (start >= fileSize) {
                    this.logger.warn(`Requested start (${start}) exceeds file size (${fileSize}).`);
                    return res.status(416).send('Requested range not satisfiable');
                }

                const chunkSize = (end - start) + 1;

                // Stream partial content
                const buffer = await this.storage.getPartialObject(previewBucket, fileName, start, chunkSize);

                // Set headers for partial content
                res.writeHead(206, {
                    'Content-Range': `bytes ${start}-${end}/${fileSize}`,
                    'Accept-Ranges': 'bytes',
                    'Content-Length': chunkSize,
                    'Content-Type': 'video/mp4',
                });

                // Send the buffer and immediately close the response
                res.end(buffer);
                this.logger.debug('Partial streaming finished.');
            } else {
                // Set headers for full content
                res.writeHead(200, {
                    'Content-Length': fileSize,
                    'Content-Type': 'video/mp4',
                });

                // Stream full content
                const dataStream = await this.storage.getObject('l1-raw', fileName);

                dataStream.on('error', (streamErr) => {
                    this.logger.error(`Stream error: ${streamErr.message}`, streamErr.stack);
                    if (!res.headersSent) {
                        res.status(HttpStatus.INTERNAL_SERVER_ERROR).send('Error during streaming');
                    }
                });

                dataStream.pipe(res).on('finish', () => {
                    this.logger.debug('Full streaming finished.');
                });
            }
        } catch (err) {
            this.logger.error(`An error occurred: ${err.message}`, err.stack);
            if (!res.headersSent) {
                return res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(err.message);
            }
        }
    }

    @Post('sync-metadata')
    @UseGuards(AuthGuard)
    async syncMetadata(@Body() body: { bucketName: string, objectName: string }, @Res() res) {
        const { bucketName, objectName } = body;
        const tempDir = path.join(__dirname, 'temp');
        const tempFilePath = path.join(tempDir, objectName);

        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir);
        }

        try {
            const filePath = await this.storage.downloadFile(bucketName, objectName, tempFilePath);
            const metadata = await this.video.extractMetadata(filePath);
            const updatedObjects = await this.db.storeVideoMetadata(bucketName, objectName, metadata);

            fs.unlinkSync(filePath);
            return res.status(200).json(updatedObjects);
        } catch (error) {
            return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ error: error.message });
        }
    }

    @Post('upload')
    @UseInterceptors(FilesInterceptor('files', 10, {
        storage: diskStorage({
            destination: './uploads',
            filename: (req, file, callback) => {
                callback(null, file.originalname);
            }
        })
    }))
    @UseGuards(AuthGuard)
    async uploadFile(
        @UploadedFiles() files: Express.Multer.File[],
        @Body() body: { customer: string; date: string; metadata: string },
        @Res() res
    ) {
        const { customer, date, metadata } = body;
    
        if (!files || files.length === 0) {
            this.logger.error('No files provided');
            return res.status(HttpStatus.BAD_REQUEST).json({ message: 'No files provided' });
        }
    
        // Parse metadata from JSON string
        let parsedMetadata: Record<string, any>[] = [];
        try {
            parsedMetadata = JSON.parse(metadata);
        } catch (error) {
            this.logger.error('Invalid metadata format');
            return res.status(HttpStatus.BAD_REQUEST).json({ message: 'Invalid metadata format', error: error.message });
        }
    
        this.logger.debug('Upload File Request Received');
        res.setHeader('Content-Type', 'application/json');
        res.write(JSON.stringify({ status: 'Processing started' }) + '\n');
    
        if (parsedMetadata.length !== files.length) {
            this.logger.error('Metadata count does not match files count');
            res.write(JSON.stringify({ status: 'error', message: 'Metadata count does not match files count' }) + '\n');
            return res.end();
        }
    
        try {
            const startTime = Date.now();
            this.logger.debug(`Start time: ${startTime}`);
    
            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                const meta = parsedMetadata[i];
    
                this.logger.debug(`Uploading to storage: ${file.originalname}`);
    
                const projectName = `${customer}_${format(new Date(date), 'yyyyMMdd')}`;
                const objectName = `${projectName}/${file.originalname}`;
                this.logger.debug(`Generated object name: ${objectName}`);
    
                // Upload raw file to MinIO with metadata
                res.write(JSON.stringify({ status: 'Uploading raw file', file: file.originalname }) + '\n');
                const rawETag = await this.storage.uploadFile('l1-raw', objectName, file.path, meta);
    
                // Check if preview is enabled in metadata
                let previewETag = null;
                if (meta.preview) {
                    // Convert video file for preview if preview is true
                    res.write(JSON.stringify({ status: 'Converting 720p', file: file.originalname }) + '\n');
                    const pathToConverted = `/tmp/muraxa/preview/${objectName}`;
                    await this.video.convertTo720p(file.path, pathToConverted);
    
                    // Upload preview file to MinIO with metadata
                    res.write(JSON.stringify({ status: 'Uploading preview file', file: file.originalname }) + '\n');
                    previewETag = await this.storage.uploadFile('l1-preview', objectName, pathToConverted, meta);
    
                    // Clean up the converted file
                    fs.unlinkSync(pathToConverted);
                }
    
                // Extract metadata
                res.write(JSON.stringify({ status: 'Extracting metadata', file: file.originalname }) + '\n');
                const metadata = await this.video.extractMetadata(file.path);
    
                // Store metadata and video links in the database
                await this.db.initObject({
                    id: objectName,
                    name: objectName,
                    created: meta.created,
                    bucket: 'l1-raw',
                    preview: meta.preview,
                });
    
                if (meta.preview && previewETag) {
                    await this.db.initObject({
                        id: objectName,
                        name: objectName,
                        created: meta.created,
                        bucket: 'l1-preview',
                        preview: true,
                    });
    
                    await this.lineage.updateObjectLink("l1-raw", objectName, {
                        serviceName: ServiceName.STORAGE_PREVIEW,
                        trackingId: previewETag,
                        references: { objectName },
                    }, LinkType.TARGET);
    
                    await this.lineage.updateObjectLink("l1-preview", objectName, {
                        serviceName: ServiceName.STORAGE_VERSION,
                        trackingId: rawETag,
                        references: { objectName },
                    }, LinkType.SOURCE);
                }
    
                await this.db.storeVideoMetadata('l1-raw', objectName, metadata);
    
                // Remove the raw file after upload
                fs.unlinkSync(file.path);
            }
    
            const endTime = Date.now();
            const duration = (endTime - startTime) / 1000;
            this.logger.debug(`End time: ${endTime}`);
            this.logger.debug(`Upload completed in ${duration} seconds`);
    
            res.write(JSON.stringify({
                status: 'Completed',
                message: `Files uploaded successfully in ${duration} seconds`,
            }) + '\n');
            return res.end();
        } catch (error) {
            this.logger.error('Error during file upload:', error);
            res.write(JSON.stringify({ status: 'error', message: 'Error uploading files', error: error.message }) + '\n');
            return res.end();
        }
    }

    @Post('create-preview')
    @UseGuards(AuthGuard)
    async createPreview(
        @Body() body: { objectNames: string[] },
        @Res() res
    ) {
        const { objectNames } = body;
    
        if (!objectNames || objectNames.length === 0) {
            this.logger.error('No object names provided for preview generation');
            return res.status(HttpStatus.BAD_REQUEST).json({ message: 'No object names provided' });
        }
    
        try {
            const startTime = Date.now();
            this.logger.debug(`Start time: ${startTime}`);
    
            for (let i = 0; i < objectNames.length; i++) {
                const objectName = objectNames[i];
                const sobject: SObject  = await this.db.getObject("l1-raw", objectName);
    
                // Upload raw file to MinIO with metadata
                res.write(JSON.stringify({ status: 'Downloading raw file', file: objectName }) + '\n');
                const pathToDownloaded = `/tmp/muraxa/downloads/${objectName}`;
                this.storage.downloadFile("l1-raw", objectName, pathToDownloaded);
    
                // Convert video file for preview if preview is true
                res.write(JSON.stringify({ status: 'Converting 720p', file: objectName }) + '\n');
                const pathToConverted = `/tmp/muraxa/previews/${objectName}`;
                await this.video.convertTo720p(pathToDownloaded, pathToConverted);
    
                // Upload preview file to MinIO with metadata
                res.write(JSON.stringify({ status: 'Uploading preview file', file: objectName }) + '\n');
                const previewETag = await this.storage.uploadFile('l1-preview', objectName, pathToConverted);

                // Clean up the converted file
                fs.unlinkSync(pathToConverted);
                fs.unlinkSync(pathToDownloaded);
    
                if (previewETag) {
                    await this.db.initObject({
                        id: objectName,
                        name: objectName,
                        created: new Date(),
                        bucket: 'l1-preview',
                        preview: false,
                    });

                    sobject.preview = true;
                    sobject.save();
    
                    await this.lineage.updateObjectLink("l1-raw", objectName, {
                        serviceName: ServiceName.STORAGE_PREVIEW,
                        trackingId: previewETag,
                        references: { objectName },
                    }, LinkType.TARGET);
    
                    await this.lineage.updateObjectLink("l1-preview", objectName, {
                        serviceName: ServiceName.STORAGE_VERSION,
                        trackingId: sobject.etag,
                        references: { objectName },
                    }, LinkType.SOURCE);
                }
            }
    
            const endTime = Date.now();
            const duration = (endTime - startTime) / 1000;
            this.logger.debug(`End time: ${endTime}`);
            this.logger.debug(`Upload completed in ${duration} seconds`);
    
            res.write(JSON.stringify({
                status: 'Completed',
                message: `Files uploaded successfully in ${duration} seconds`,
            }) + '\n');
            return res.end();
        } catch (error) {
            this.logger.error('Error during file upload:', error);
            res.write(JSON.stringify({ status: 'error', message: 'Error uploading files', error: error.message }) + '\n');
            return res.end();
        }
    }
    
    @Post('cut-selection')
    @UseGuards(AuthGuard)
    async cutSelection(
        @Body() body: { bucketName: string; objectName: string; selections: any[]; taskName: string },
        @Res() res,
    ) {
        const tmpFolder = '/tmp/muraxa/storage'
        const { bucketName, objectName, selections } = body;
        const sourcePath = path.join(tmpFolder, `downloads/${objectName}`);
        const destinationPath = path.join(tmpFolder, `processed/${objectName}_v1.mp4`);

        const startTime = Date.now();
        // Extract the base name (without extension) and file extension
        // Extract the file extension
        const fileExtension = objectName.slice(objectName.lastIndexOf("."));
        // Extract the base name (everything before the extension)
        const baseName = objectName.slice(0, objectName.lastIndexOf("."));

        // Construct the new object name with the start time inserted before the file extension
        const uploadObjectName = `${baseName}_${startTime}${fileExtension}`;

        this.logger.debug(`Starting cut-selection object: ${objectName}, bucket: ${bucketName}`);
        try {
            // Step 1: Download file from MinIO
            this.logger.debug('Downloading file from MinIO...');
            await this.storage.downloadFile(bucketName, objectName, sourcePath);
            this.logger.debug('Download completed.');

            // Step 2: Process the file with selections
            if (selections && selections.length > 0) {
                this.logger.debug('Processing file with provided selections...');
                await this.video.cutSelections(sourcePath, destinationPath, selections);
                this.logger.debug('File processing completed.');
            } else {
                this.logger.warn('No selections provided, skipping processing.');
                return res
                    .status(HttpStatus.BAD_REQUEST)
                    .json({ message: 'Selections are required for processing.' });
            }

            // Step 3: Upload the processed file back to MinIO
            this.logger.debug(`Uploading processed file to MinIO as ${uploadObjectName}...`);
            const etag = await this.storage.uploadFile(bucketName, uploadObjectName, destinationPath);
            this.logger.debug('Upload completed.');

            // Step 4: Update DB
            const object = await this.db.getObject("l1-raw", objectName);
            const metadata = await this.video.extractMetadata(destinationPath);
            await this.db.initObject({ id: uploadObjectName, name: uploadObjectName, created: new Date(), bucket: 'l1-raw', original: false });
            await this.lineage.updateObjectLink("l1-raw", objectName, {
                serviceName: ServiceName.STORAGE_VERSION,
                trackingId: etag,
                references: { objectName: uploadObjectName },
            }, LinkType.TARGET);
            await this.lineage.updateObjectLink("l1-raw", uploadObjectName, {
                serviceName: ServiceName.STORAGE_VERSION,
                trackingId: object.etag,
                references: { objectName: objectName },
            }, LinkType.SOURCE);
            await this.db.setActiveVersion("l1-raw", objectName, uploadObjectName);
            await this.db.storeVideoMetadata('l1-raw', uploadObjectName, metadata);

            // Step 4: Clean up temporary files
            this.logger.debug('Cleaning up temporary files...');
            await this.video.deleteFile(sourcePath);
            await this.video.deleteFile(destinationPath);
            this.logger.debug('Temporary files cleaned up.');

            // Calculate and log duration
            const endTime = Date.now();
            const duration = (endTime - startTime) / 1000;
            this.logger.debug(`Task completed in ${duration} seconds.`);

            return res.status(HttpStatus.OK).json({
                message: `File processed and uploaded successfully in ${duration} seconds.`,
                processedObjectName: uploadObjectName
            });
        } catch (error) {
            this.logger.error('Error processing file:', error);
            return res
                .status(HttpStatus.INTERNAL_SERVER_ERROR)
                .json({ message: 'Error processing file', error: error.message });
        }
    }

    @Post('ingest-video')
    @UseGuards(AuthGuard)
    async ingestVideo(
        @Body() body: { objectName: string; projectName: string },
        @Res() res
    ) {
        const { objectName, projectName } = body;

        if (!objectName || !projectName) {
            this.logger.error('Missing required parameters: objectName or projectName');
            return res
                .status(HttpStatus.BAD_REQUEST)
                .json({ message: 'objectName and projectName are required.' });
        }

        const sourcePath = path.join('./downloads', objectName);

        try {
            this.logger.log(`Starting ingestion for object: ${objectName}, project: ${projectName}`);

            // Step 1: Download file from MinIO
            this.logger.debug('Downloading file from MinIO...');
            await this.storage.downloadFile('l1-raw', objectName, sourcePath);
            this.logger.debug('File downloaded successfully.');

            // Step 2: Initialize task ingestion
            this.logger.debug('Initializing task ingestion...');
            await this.ingest.videoToDatalake(objectName, projectName, sourcePath);
            this.logger.log('Task ingestion completed successfully.');

            // Step 3: Send success response
            return res
                .status(HttpStatus.OK)
                .json({ message: 'Success processing task' });
        } catch (error) {
            this.logger.error('Error processing task:', error);
            return res
                .status(HttpStatus.INTERNAL_SERVER_ERROR)
                .json({ message: 'Error processing task', error: error.message });
        } finally {
            // Step 4: Cleanup temporary files
            try {
                this.logger.debug('Cleaning up temporary files...');
                await this.video.deleteFile(sourcePath);
                this.logger.debug('Temporary files cleaned up.');
            } catch (cleanupError) {
                this.logger.warn('Error during cleanup:', cleanupError);
            }
        }
    }


    private groupByBucket(data) {
        return data.reduce((acc, obj) => {
            const { bucket, ...rest } = obj.toObject();
            if (!acc[bucket]) {
                acc[bucket] = [];
            }
            acc[bucket].push(rest);
            return acc;
        }, {});
    }
}