import { Controller, Post, Body, Res, UseGuards, UploadedFiles, HttpStatus, UseInterceptors, Logger, Inject } from '@nestjs/common';
import { AuthGuard } from 'src/auth/auth.guard.rpc';
import { FilesInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { StorageConnector } from 'src/connectors/storage.connector';
import * as fs from "fs";
import { IngestService } from 'src/services/ingest.service';
    
@Controller('api')
export class IngestController {

    private readonly logger = new Logger(IngestController.name);

    constructor(
        @Inject('StorageConnector') private readonly storage: StorageConnector,
        private readonly ingest: IngestService,
    ) { }
    
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
    async uploadFiles(
        @UploadedFiles() files: Express.Multer.File[],
        @Body() body: { customer: string; datasetName: string; metadata: string },
        @Res() res
    ) {
        const { customer, datasetName, metadata } = body;

        if (!files || files.length === 0) {
            this.logger.error('No files provided');
            return res.status(HttpStatus.BAD_REQUEST).json({ message: 'No files provided' });
        }

        this.logger.debug('Upload File Request Received');
        res.setHeader('Content-Type', 'application/json');
        res.write(JSON.stringify({ status: 'Processing started' }) + '\n');

        const filePaths: string[] = files.map(file => file.path);
        const objectPath = `${customer}/${datasetName}`;

        try {

            const resLogger = (message: string, progress: number) => {
                res.write(JSON.stringify({ status: message, progress }) + '\n');
            }

            this.ingest.imagesetToDatalake(objectPath, filePaths, resLogger)

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