import {
    Controller,
    Post,
    Get,
    Header,
    Body,
    Res,
    UseGuards,
    Logger,
    HttpStatus
} from '@nestjs/common';
import { GrpcMethod } from '@nestjs/microservices';
import { StorageService } from '../services/storage.service'; // Mongo service for database interactions
import { AuthGuard } from '../auth/auth.guard.rpc'; // Auth guard for route protection
import * as path from 'path';
import { Response } from 'express';

@Controller('api/meta')
export class MetaController {

    private readonly logger = new Logger(MetaController.name);

    constructor(
        private readonly db: StorageService,
    ) { }

    /**
     * HTTP endpoint to download the .proto file
     */
    @Get('download-proto')
    @UseGuards(AuthGuard)
    @Header('Content-Type', 'application/octet-stream')  // Optional: set content type to binary for file downloads
    @Header('Content-Disposition', 'attachment; filename="service.proto"') // Specify the file name
    async downloadProto(@Res() res: Response) {
        const filePath = path.join(__dirname, '..', 'storage.proto');  // Path to the .proto file

        try {
            return res.sendFile(filePath);
        } catch (error) {
            this.logger.error('Error downloading proto file', error);
            return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ error: 'Failed to download the file' });
        }
    }

    /**
     * HTTP endpoint to update object targets
     */
    @Post('update-target')
    @UseGuards(AuthGuard)
    async updateTarget(
        @Body() body: { bucket: string; objectName: string; target: { globalId: string; selections: any } },
        @Res() res
    ) {
        const { bucket, objectName, target } = body;

        try {
            const updatedObject = await this.db.updateObjectTargets(bucket, objectName, target);
            if (!updatedObject) {
                return res.status(HttpStatus.NOT_FOUND).json({ error: 'Object not found' });
            }

            return res.status(HttpStatus.OK).json(updatedObject);
        } catch (error) {
            this.logger.error('Error updating object target', error);
            return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ error: error.message });
        }
    }

    // HTTP endpoint to tag an object
    @Post('tag-object')
    @UseGuards(AuthGuard)
    async tagObject(
        @Body() body: { objectName: string; tags: any[]; bucket: string },
        @Res() res: Response
    ) {
        const { objectName, tags, bucket } = body;

        try {
            const updatedObject = await this.db.tagObject(bucket, objectName, tags);

            if (!updatedObject) {
                return res.status(HttpStatus.NOT_FOUND).json({ error: 'Object not found' });
            }

            return res.status(HttpStatus.OK).json(updatedObject);
        } catch (error) {
            this.logger.error('Error tagging object', error);
            return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ error: 'Error adding tags' });
        }
    }

    /**
     * gRPC method to update object targets
     */
    @GrpcMethod('MetaService', 'UpdateTarget')
    async updateTargetGrpc(data: { bucket: string; objectName: string; target: { globalId: string; selections: any } }) {
        const { bucket, objectName, target } = data;

        try {
            const updatedObject = await this.db.updateObjectTargets(bucket, objectName, target);
            if (!updatedObject) {
                return { success: false, message: 'Object not found' };
            }

            return { success: true, updatedObject };
        } catch (error) {
            this.logger.error('Error updating object target via gRPC', error);
            return { success: false, message: error.message };
        }
    }

}