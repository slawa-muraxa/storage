import { Controller, Get, Post, Body, Query, Req, Res, UseGuards, UploadedFiles, HttpStatus, UseInterceptors, Logger, Headers, Inject } from '@nestjs/common';
import { StorageConnector } from './connectors/storage.connector';
import { VideoService } from './services/video.service';  
import { IngestService } from './services/ingest.service';  
import { StorageService } from './services/storage.service';  // Mongo service to interact with your database
import { AuthGuard } from './auth/auth.guard.rpc';  // Auth guard for route protection
import * as fs from 'fs';
import * as path from 'path';
import { format } from 'date-fns';
import { FilesInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';

@Controller('api')
export class StorageController {

    private readonly logger = new Logger(StorageController.name);

    constructor(
        @Inject('StorageConnector') private readonly storage: StorageConnector,
        private readonly video: VideoService,
        private readonly db: StorageService,
        private readonly ingest: IngestService,
    ) { }

    @Get('sync-minio-structure')
    @UseGuards(AuthGuard)  // Use the custom auth guard here
    async syncMinioStructure(@Req() req, @Res() res) {
        try {
            console.log('Start syncing MinIO buckets');
            const buckets = ["l1-raw", "l2-prep", "l3-rel"];
            const newBucketData = await Promise.all(buckets.map(async (bucket) => {
                const objects = await this.storage.listAllObjects(bucket,'');
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
        try {
            this.logger.debug(`Received request to stream file: ${fileName}`);

            const fileStats = await this.storage.getObjectStats('l1-raw', fileName);
            const fileSize = fileStats.size;
            this.logger.debug(`File size retrieved: ${fileSize} bytes`);

            this.logger.debug(`Request range: ${range ? range : 'Full content requested'}`);

            if (range) {
                const parts = range.replace(/bytes=/, "").split("-");
                const start = parseInt(parts[0], 10);
                const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
                this.logger.debug(`Parsed range - Start: ${start}, End: ${end}`);

                if (start >= fileSize) {
                    this.logger.warn(`Requested start (${start}) exceeds file size (${fileSize}).`);
                    return res.status(416).send('Requested range not satisfiable');
                }

                const chunkSize = (end - start) + 1;
                this.logger.debug(`Chunk size calculated: ${chunkSize} bytes`);

                res.writeHead(206, {
                    'Content-Range': `bytes ${start}-${end}/${fileSize}`,
                    'Accept-Ranges': 'bytes',
                    'Content-Length': chunkSize,
                    'Content-Type': 'video/mp4',
                });
                this.logger.debug(`Response headers for partial content set.`);

                const dataStream = await this.storage.getPartialObject('l1-raw', fileName, start, chunkSize);
                this.logger.debug(`Streaming partial content...`);
                dataStream.pipe(res);
            } else {
                res.writeHead(200, {
                    'Content-Length': fileSize,
                    'Content-Type': 'video/mp4',
                });
                this.logger.debug(`Response headers for full content set.`);

                const dataStream = await this.storage.getObject('l1-raw', fileName);
                this.logger.debug(`Streaming full content...`);
                dataStream.pipe(res);
            }
        } catch (err) {
            this.logger.error(`An error occurred: ${err.message}`, err.stack);
            return res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(err.message);
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
            destination: './uploads', // Use a local temp folder or directly upload to MinIO
            filename: (req, file, callback) => {
                callback(null, file.originalname); // Generate a filename, or use your own strategy
            }
        })
    }))
    @UseGuards(AuthGuard)
    async uploadFile(@UploadedFiles() files: Express.Multer.File[], @Body() body: { customer: string, date: string }, @Res() res) {
        const { customer, date } = body;

        if (!files || files.length === 0) {
            this.logger.error('No files provided');
            return res.status(HttpStatus.BAD_REQUEST).json({ message: 'No files provided' });
        }

        this.logger.debug('Upload File Request Received');
        this.logger.debug(`Customer: ${customer}, Date: ${date}`);
        this.logger.debug(`Files: ${JSON.stringify(files)}`);
        this.logger.debug(`Number of files to upload: ${files.length}`);

        try {
            const startTime = Date.now();
            this.logger.debug(`Start time: ${startTime}`);

            for (const file of files) {
                this.logger.debug(`Processing file: ${file.originalname}`);

                const objectName = `${customer}_${format(new Date(date), 'yyMMdd')}/${file.originalname}`;
                this.logger.debug(`Generated object name: ${objectName}`);

                // Upload the file to MinIO
                await this.storage.uploadFile('l1-raw', objectName, file.path);
                this.logger.debug(`File uploaded: ${objectName}`);

                // Remove the file after upload
                fs.unlinkSync(file.path);
                this.logger.debug(`File removed from local storage: ${file.path}`);
            }

            const endTime = Date.now();
            const duration = (endTime - startTime) / 1000;
            this.logger.debug(`End time: ${endTime}`);
            this.logger.debug(`Upload completed in ${duration} seconds`);

            return res.status(HttpStatus.OK).json({ message: `Files uploaded successfully in ${duration} seconds` });
        } catch (error) {
            this.logger.error('Error during file upload:', error);
            return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ message: 'Error uploading files', error: error.message });
        }
    }


    @Post('cut-selection')
    @UseGuards(AuthGuard)
    async cutSelection(
        @Body() body: { bucketName: string; objectName: string; selections: any[]; taskName: string },
        @Res() res,
    ) {
        const { bucketName, objectName, selections } = body;
        const sourcePath = `./downloads/${objectName}`;
        const destinationPath = `./processed/${objectName}_v1.mp4`;

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
            await this.storage.uploadFile(bucketName, uploadObjectName, destinationPath);
            this.logger.debug('Upload completed.');

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