import { Controller, Get, Post, Body, Query, Req, Res, UseGuards, UploadedFiles, HttpStatus, UseInterceptors, Logger, Headers, Inject } from '@nestjs/common';
import { StorageConnector } from '../connectors/storage.connector';
import { VideoService } from '../services/video.service';
import { StorageService } from '../services/storage.service';  // Mongo service to interact with your database
import { LineageService, LinkType } from '../services/lineage.service';  // Mongo service to interact with your database
import { AuthGuard } from '../auth/auth.guard.rpc';  // Auth guard for route protection
import * as fs from 'fs';
import { format } from 'date-fns';
import { FilesInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { ServiceName, SObject } from '../schemas/sobject.schema';

@Controller('api/upload')
export class UploadController {

    private readonly logger = new Logger(UploadController.name);

    constructor(
        @Inject('StorageConnector') private readonly storage: StorageConnector,
        private readonly video: VideoService,
        private readonly db: StorageService,
        private readonly lineage: LineageService,
    ) { }

    @Post('dataset')
    @UseInterceptors(FilesInterceptor('files', 10, {
        storage: diskStorage({
            destination: './uploads',
            filename: (req, file, callback) => {
                callback(null, file.originalname);
            }
        })
    }))
    @UseGuards(AuthGuard)
    async uploadDataset(
        @UploadedFiles() files: Express.Multer.File[],
        @Body() body: { project: string; metadata: string },
        @Res() res
    ) {
        const { project, metadata } = body;

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

        this.logger.debug('Upload Dataset File Request Received');
        res.setHeader('Content-Type', 'application/json');
        res.write(JSON.stringify({ status: 'Processing started' }) + '\n');

        if (parsedMetadata.length !== files.length) {
            this.logger.error('Metadata count does not match files count');
            res.write(JSON.stringify({ status: 'error', message: 'Metadata count does not match files count' }) + '\n');
            return res.end();
        }

        try {

            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                const meta = parsedMetadata[i];

                this.logger.debug(`Uploading to storage: ${file.originalname}`);

                const projectName = `${project}`;
                const objectName = `${projectName}/${file.originalname}`;
                this.logger.debug(`Generated object name: ${objectName}`);

                // Upload raw file to MinIO with metadata
                res.write(JSON.stringify({ status: 'Uploading raw file', file: file.originalname }) + '\n');
                const relETag = await this.storage.uploadFile('l3-rel', objectName, file.path, meta);

                // Store metadata and video links in the database
                await this.db.initObject({
                    id: objectName,
                    name: objectName,
                    created: meta.created,
                    bucket: 'l3-rel',
                    //preview: meta.preview,
                });

                if (meta.source) {

                    const rawObject = await this.db.getObject("l1-raw", meta.source);

                    await this.lineage.updateObjectLink("l1-raw", meta.source, {
                        serviceName: ServiceName.STORAGE_DATASET,
                        trackingId: relETag,
                        references: { objectName },
                    }, LinkType.TARGET);

                    await this.lineage.updateObjectLink("l3-rel", objectName, {
                        serviceName: ServiceName.STORAGE_VERSION,
                        trackingId: rawObject.etag,
                        references: { objectName: rawObject.id },
                    }, LinkType.SOURCE);
                }

                await this.db.updateAttributes('l3-rel', objectName, [{name:'format', value: meta.format}]);

                // Remove the raw file after upload
                fs.unlinkSync(file.path);
            }

            res.write(JSON.stringify({
                status: 'Completed',
                message: `Files uploaded successfully`,
            }) + '\n');
            return res.end();
        } catch (error) {
            this.logger.error('Error during file upload:', error);
            res.write(JSON.stringify({ status: 'error', message: 'Error uploading files', error: error.message }) + '\n');
            return res.end();
        }
    }

}