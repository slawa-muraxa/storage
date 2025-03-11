import { Controller, Post, Body, Res, UseGuards,HttpStatus, Logger, Inject } from '@nestjs/common';
import { StorageConnector } from '../connectors/storage.connector';
import { StorageService } from '../services/storage.service';  // Mongo service to interact with your database
import { AuthGuard } from '../auth/auth.guard.rpc';  // Auth guard for route protection
import * as fs from 'fs';
import * as path from 'path';
import { ZipFileProcessorService } from 'src/services/zipfile.service';
import { DatasetService } from 'src/services/dataset.service';

@Controller('api/metadata')
export class MetadataController {

    private readonly logger = new Logger(MetadataController.name);

    constructor(
        @Inject('StorageConnector') private readonly storage: StorageConnector,
        private readonly db: StorageService,
        private readonly zip: ZipFileProcessorService,
        private readonly dataset: DatasetService
    ) { }
ta
    @Post('sync-dataset')
    @UseGuards(AuthGuard)
    async syncMetadata(@Body() body: { bucketName: string, objectName: string }, @Res() res) {
        const { bucketName, objectName } = body;
        const tempDir = '/tmp/muraxa/storage/dataset';
        const tempFilePath = path.join(tempDir, objectName);

        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir);
        }

        try {
            const filePath = await this.storage.downloadFile(bucketName, objectName, tempFilePath);
            const annotationFile = await this.zip.extractAnnotationsXml(filePath, tempDir);
            const attributes: any[] = this.dataset.readMetadata(annotationFile);
            const datasetObjects: any[] = this.dataset.readObjects(annotationFile);

            await this.db.tagObject(bucketName, objectName, datasetObjects);
            await this.db.amendAttributes(bucketName, objectName, attributes);

            const object = await this.db.getObject(bucketName, objectName);

            fs.unlinkSync(filePath);
            fs.unlinkSync(annotationFile);
            return res.status(200).json(object);
        } catch (error) {
            return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ error: error.message });
        }
    }

}