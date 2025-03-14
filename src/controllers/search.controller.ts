import { Controller, Get, Post, Body, Query, Req, Res, UseGuards, UploadedFiles, HttpStatus, UseInterceptors, Logger, Headers, Inject } from '@nestjs/common';
import { StorageService } from '../services/storage.service';  // Mongo service to interact with your database
import { AuthGuard } from '../auth/auth.guard.rpc';  // Auth guard for route protection
import * as fs from 'fs';
import * as path from 'path';
import { format } from 'date-fns';
import { FilesInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { ServiceName, SObject } from '../schemas/sobject.schema';
import { SearchService } from 'src/services/search.service';

@Controller('api/search')
export class SearchController {

    private readonly logger = new Logger(SearchController.name);

    constructor(
        private readonly search: SearchService,
    ) { }

    @Get('fetch-linked-objects')
    @UseGuards(AuthGuard)
    async fetchMinioStructure(@Query('objectName') objectName: string, @Query('bucket') bucket: string, @Res() res) {
        try {
            const activeData = await this.search.getLinkedObjects(bucket, objectName);
            return res.json(this.groupByBucket(activeData));
        } catch (err) {
            return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ error: err.message });
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