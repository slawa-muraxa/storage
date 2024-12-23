import {
    Controller,
    Post,
    Get,
    Body,
    Res,
    UseGuards,
    Logger,
    HttpStatus
} from '@nestjs/common';
import { TagService } from '../tags/tag.service'; // Mongo service for database interactions
import { AuthGuard } from '../auth/auth.guard.rpc'; // Auth guard for route protection
import { Response } from 'express';

@Controller('api/tags')
export class TagController {

    private readonly logger = new Logger(TagController.name);

    constructor(
        private readonly tagService: TagService,
    ) { }

    @Post()
    @UseGuards(AuthGuard)
    async addTag(
        @Body() body: { name: string; color?: string },
        @Res() res: Response,
    ) {
        const { name, color } = body;

        try {
            const newTag = await this.tagService.addTag(name, color);
            return res.status(HttpStatus.CREATED).json(newTag);
        } catch (error) {
            this.logger.error('Error adding new tag', error);

            if (error.status === HttpStatus.CONFLICT) {
                return res
                    .status(HttpStatus.CONFLICT)
                    .json({ error: 'Tag already exists' });
            }

            return res
                .status(HttpStatus.INTERNAL_SERVER_ERROR)
                .json({ error: 'Error adding tag' });
        }
    }

    @Get()
    @UseGuards(AuthGuard)
    async getAllTags(@Res() res: Response) {
      try {
        const tags = await this.tagService.getAllTags();
        return res.status(HttpStatus.OK).json(tags);
      } catch (error) {
        this.logger.error('Error fetching tags', error);
        return res
          .status(HttpStatus.INTERNAL_SERVER_ERROR)
          .json({ error: 'Error syncing tags' });
      }
    }
}