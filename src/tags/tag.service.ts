import { Injectable, Logger, ConflictException } from '@nestjs/common';
import { Model, Connection } from 'mongoose';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Tag } from '../schemas/tag.schema';

@Injectable()
export class TagService {
  private readonly logger = new Logger(TagService.name);

  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(Tag.name) private readonly tagModel: Model<Tag>,
  ) {}

  async getAllTags(): Promise<Tag[]> {
    try {
      return await this.tagModel.find().exec();
    } catch (error) {
      this.logger.error('Error fetching tags', error);
      throw error;
    }
  }

  async addTag(name: string, color?: string): Promise<Tag> {
    try {
      const tag = new this.tagModel({ name, color });
      return await tag.save();
    } catch (error) {
      this.logger.error('Error adding new tag', error);
      if (error.code === 11000) {
        throw new ConflictException('Tag already exists');
      }
      throw error;
    }
  }
}
