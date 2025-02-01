import { Controller, Post, Body, Res, HttpStatus, Logger } from '@nestjs/common';
import { Response } from 'express';

@Controller('webhooks')
export class MinioWebhookController {
  private readonly logger = new Logger(MinioWebhookController.name);

  @Post('minio')
  async handleMinioWebhook(@Body() notification: any, @Res() res: Response): Promise<Response> {
    try {
      // Extract the object key from the notification payload
      const objectKey = notification?.Records?.[0]?.s3?.object?.key;

      if (!objectKey) {
        this.logger.warn('No object key found in the webhook notification.');
        return res
          .status(HttpStatus.BAD_REQUEST)
          .json({ message: 'Invalid notification payload.' });
      }

      this.logger.debug(`Received notification for object: ${objectKey}`);

      // Check if the object belongs to the "annotations" folder
      if (objectKey.startsWith('annotations/')) {
        this.logger.log(`New object in annotations: ${objectKey}`);
        // Add logic to handle annotations objects
      } else {
        this.logger.log(`Event ignored for object: ${objectKey}`);
      }

      return res.status(HttpStatus.OK).send('OK');
    } catch (error) {
      this.logger.error('Error processing MinIO webhook notification:', error);
      return res
        .status(HttpStatus.INTERNAL_SERVER_ERROR)
        .json({ message: 'An error occurred while processing the notification.', error: error.message });
    }
  }
}
