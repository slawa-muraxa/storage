import { Inject, Injectable, Logger } from "@nestjs/common";
import { VideoService } from "./video.service";
import { StorageConnector } from "../connectors/storage.connector";
import { KafkaConnector } from "../connectors/kafka.connector";
import * as path from "path";
import * as fs from "fs";

@Injectable()
export class IngestService {
  private readonly logger = new Logger(IngestService.name);

  constructor(
    private readonly videoService: VideoService,
    @Inject('StorageConnector') private readonly storage: StorageConnector,
    private readonly kafka: KafkaConnector
  ) {}

  /**
   * Initializes the ingestion process for a given task.
   * @param task Task details including project ID and name.
   * @param sourcePath Path to the source video file.
   */
  async videoToDatalake(
    objectName: string,
    projectName: string,
    sourcePath: string
  ): Promise<void> {
    const dstPath = `${path.basename(objectName)}`;
    const tmpDir = path.join(__dirname, "tmp");
    const tmpImages = path.join(tmpDir, dstPath);
    const tmpPreviewImages = path.join(tmpDir, dstPath + "-preview");
    const storagePath = `${projectName}/${dstPath}/images/default`;
    const previewStoragePath = `${projectName}/${dstPath}/preview/default`;

    try {
      this.logger.log(`Starting ingestion for task ${dstPath}`);

      const framePublisher: FramePublisher = new FramePublisher(objectName, this.kafka)

      // Fragment video and store frames in temporary directory
      await this.videoService.videoFragmentation(sourcePath, tmpImages, "lossless", framePublisher);
      await this.ingestImages(tmpImages, storagePath, "l4-dl", framePublisher);
      await this.videoService.cleanupDirectory(tmpImages);

      // Fragment video and store frames in temporary directory
      await this.videoService.videoFragmentation(sourcePath, tmpPreviewImages, "preview", null);
      await this.ingestImages(tmpPreviewImages, previewStoragePath, "l4-dl", null);
      await this.videoService.cleanupDirectory(tmpPreviewImages);

      framePublisher.publishFrameMeta();

      this.logger.log(`Completed ingestion for task ${dstPath}`);
    } catch (error) {
      this.logger.error(`Error during ingestion for task ${dstPath}`, error);
    }
  }

  /**
   * Ingests images by uploading them recursively to a MinIO bucket.
   * @param sourceDirectory Path to the source directory containing images.
   * @param targetPath Path within the MinIO bucket.
   * @param bucketName MinIO bucket name.
   */
  private async ingestImages(
    sourceDirectory: string,
    targetPath: string,
    bucketName: string,
    framePublisher: FramePublisher
  ): Promise<void> {
    const uploadFiles = async (dir: string, targetDir: string) => {
      const files = fs.readdirSync(dir);
      let fileCount = 0;
    
      for (const file of files) {
        const fullPath = path.join(dir, file);
        const targetFilePath = path.join(targetDir, file);
        const fileName = path.basename(file, path.extname(file));
    
        if (!fs.lstatSync(fullPath).isDirectory()) {
          // Upload file to MinIO
          const info = await this.storage.putObject(bucketName,targetFilePath,fullPath);
          framePublisher?.recordFrameMetadata(fileCount++, fileName, targetFilePath, info.etag, bucketName);
        }
      }
    };

    try {
      this.logger.log("Starting image ingestion...");
      await uploadFiles(sourceDirectory, targetPath);
      this.logger.log("Image ingestion completed.");
    } catch (error) {
      this.logger.error("Error during image ingestion:", error);
    }
  }
}

export class FramePublisher {

  private sourceVideo: string;
  private kafka: KafkaConnector; 
  private width: number;
  private height: number;

  private frames: any[] = [];

  constructor(sourceVideo: string, kafka: KafkaConnector) {
    this.sourceVideo = sourceVideo;
    this.kafka = kafka; 
  }

  public async recordFrameMetadata(
    frameNumber: number,
    frameName: string,
    frameSource: string,
    etag:string, 
    bucket:string
  ) {
    try {
      // Create the frame object
      const frameObject = {
        id: frameName,
        annotations: [],
        attr: {
          frame: frameNumber,
        },
        image: {
          path: `${frameName}.png`,
          size: [this.width, this.height],
        },
        sourceVideo: this.sourceVideo,
        sourceFrame: frameSource,
        etag,
        bucket
      };

      this.frames.push(frameObject);

      console.log(`Frame metadata recorded for: ${frameName}`);
    } catch (err) {
      console.error("Error inserting frame:", err);
    }
  }

  public recordVideoMeta(width: number, height: number) {
    this.width = width;
    this.height = height;
  }

  public publishFrameMeta() {
    this.kafka.publishFrameUpdate(this.frames)
  }
}
