import * as path from 'path';
import * as fs from 'fs/promises';
import * as sharp from 'sharp';

export class ImageService {
  async processImage(filePath: string) {
    const metadata = await sharp(filePath).metadata(); // Extract metadata

    const outputDir = path.join(path.dirname(filePath), 'preview'); // Target directory
    await fs.mkdir(outputDir, { recursive: true }); // Ensure directory exists

    const compressedImagePath = path.join(outputDir, path.basename(filePath).replace(/\.\w+$/, '.png')); // Change extension to .png in preview folder

    await sharp(filePath)
      .resize({ width: 1024 }) // Resize if needed
      .toFormat('png', { quality: 80 }) // Convert to PNG
      .toFile(compressedImagePath); // Save processed file

    return {
      compressedImagePath,
      metadata,
    };
  }
}