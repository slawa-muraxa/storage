import {
    Controller,
    Post,
    Body,
    Res,
    UseGuards,
    Logger,
    HttpStatus
} from '@nestjs/common';
import { LineageService, LinkType } from '../services/lineage.service'; // Mongo service for database interactions
import { AuthGuard } from '../auth/auth.guard.rpc'; // Auth guard for route protection
import { ServiceName } from 'src/schemas/sobject.schema';

@Controller('api/lineage')
export class LineageController {

    private readonly logger = new Logger(LineageController.name);

    constructor(
        private readonly lineage: LineageService,
    ) { }

    @Post('update-source-links')
    @UseGuards(AuthGuard)
    async updateSources(
        @Body() body: { bucket: string; objectName: string; links: { serviceName: ServiceName; reference: string }[] },
        @Res() res
    ) {
        const { bucket, objectName, links } = body;
    
        try {
            const updatedLinks = [];
            
            for (const link of links) {
                const updated = await this.lineage.reLinkObject(bucket, objectName, link.serviceName, link.reference, LinkType.SOURCE);
                updatedLinks.push(updated);
            }
    
            return res.status(HttpStatus.OK).json({ updatedLinks });
        } catch (error) {
            this.logger.error('Error updating object target', error);
            return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ error: error.message });
        }
    }

}