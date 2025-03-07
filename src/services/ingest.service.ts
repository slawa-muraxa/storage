import { Inject, Injectable, Logger } from "@nestjs/common";
import { VideoService } from "./video.service";
import { StorageConnector } from "../connectors/storage.connector";
import { StorageService } from "../services/storage.service";
import { LineageService, LinkType } from "../services/lineage.service";
import { KafkaConnector } from "../connectors/kafka.connector";
import { ServiceName } from "../schemas/sobject.schema";
import * as path from "path";
import * as fs from "fs";
import { ImageService } from "./image.service";

@Injectable()
export class IngestService {
  private readonly logger = new Logger(IngestService.name);

  constructor(
    private readonly videoService: VideoService,
    private readonly imageService: ImageService,
    private readonly storageService: StorageService,
    private readonly lineage: LineageService,
    @Inject('StorageConnector') private readonly storage: StorageConnector,
    private readonly kafka: KafkaConnector
  ) { }

  /**
   * Stores lineage metadata in storage and initializes the object in the database.
   * @param frameObjectLinkPath Path where lineage metadata is stored.
   * @param objectName Name of the object being processed.
   */
  private async storeLineageMetadata(frameObjectLinkPath: string, objectName: string) {
    const dlObject = await this.storage.putTextObject(frameObjectLinkPath, objectName, "l4-dl");
    const dlDbObject = {
      id: frameObjectLinkPath,
      bucket: "l4-dl",
      name: frameObjectLinkPath,
      etag: dlObject.ETag,
      size: dlObject.Size,
      active: true,
    };
    await this.storageService.initObject(dlDbObject);
    return dlObject;
  }

  /**
   * Updates lineage links between the raw and processed objects.
   * @param objectName Name of the object being processed.
   * @param frameObjectLinkPath Path where lineage metadata is stored.
   * @param dlObject Object metadata from the storage operation.
   */
  private async updateLineageLinks(objectName: string, frameObjectLinkPath: string, dlObject: any) {
    const sourceObject = await this.storageService.getObject("l1-raw", objectName);

    await this.lineage.updateObjectLink("l1-raw", objectName, {
      serviceName: ServiceName.STORAGE_LAKE,
      trackingId: dlObject.ETag,
      references: { objectName: frameObjectLinkPath },
    }, LinkType.TARGET);

    await this.lineage.updateObjectLink("l4-dl", frameObjectLinkPath, {
      serviceName: ServiceName.STORAGE_VERSION,
      trackingId: sourceObject.etag,
      references: { objectName },
    }, LinkType.SOURCE);
  }

  /**
   * Initializes the ingestion process for a given task.
   * @param objectName Task details including project ID and name.
   * @param sourcePath Path to the source video file.
   */
  async videoToDatalake(
    objectName: string,
    sourcePath: string,
    logger: (message: string, progress: number) => void
  ): Promise<void> {
    const objectBasename = `${path.basename(objectName)}`;
    const tmpDir = path.join("/tmp/muraxa/frames", objectName);
    const tmpImages = path.join(tmpDir, "raw");
    const storagePath = `${objectName}`;
    const frameObjectLinkPath = `${objectName}/${objectBasename}.link`;

    try {
      this.logger.debug(`Starting ingestion for: ${objectName}`);

      const framePublisher: FramePublisher = new FramePublisher(objectName, this.kafka);

      // Fragment video and store frames in temporary directory
      logger("Creating raw frames ...", 60);
      await this.videoService.videoFragmentation(sourcePath, tmpImages, "lossless");
      logger("Uploading raw frames ...", 70);
      await this.ingestDirImages(tmpImages, storagePath, "l4-dl", framePublisher);
      await this.videoService.cleanupDirectory(tmpImages);

      // Establishing lineage
      const dlObject = await this.storeLineageMetadata(frameObjectLinkPath, objectName);
      await this.updateLineageLinks(objectName, frameObjectLinkPath, dlObject);
   
      // Publishing events
      framePublisher.publishFrameMeta();

      this.logger.debug(`Completed ingestion for task ${objectName}`);
    } catch (error) {
      this.logger.error(`Error during ingestion for task ${objectName}`, error);
    }
  }

  /**
   * Initializes the ingestion process for a given task.
   * @param objectPath Task details including project ID and name.
   * @param sourcePath Path to the source video file.
   */
  async imagesetToDatalake(
    objectPath: string,
    files: string[],
    logger: (message: string, progress: number) => void
  ): Promise<void> {
    const objectBasename = `${path.basename(objectPath)}`;
    const frameObjectLinkPath = `${objectPath}/${objectBasename}.link`;

    try {
      this.logger.debug(`Starting ingestion for: ${objectPath}`);

      const framePublisher: FramePublisher = new FramePublisher(null, this.kafka);

      logger("Uploading raw frames ...", 75);
      await this.uploadFiles(files, objectPath, "l4-dl", framePublisher)

      // Publishing events
      framePublisher.publishFrameMeta();

      this.logger.debug(`Completed ingestion for task ${objectPath}`);
    } catch (error) {
      this.logger.error(`Error during ingestion for task ${objectPath}`, error);
    }
  }

  private async ingestDirImages(
    sourceDirectory: string,
    targetPath: string,
    bucketName: string,
    framePublisher: FramePublisher
  ): Promise<void> {
    try {
      this.logger.log("Starting image ingestion...");

      // Collect full file paths instead of just names
      const files = fs.readdirSync(sourceDirectory).map(file => path.join(sourceDirectory, file));

      await this.uploadFiles(files, targetPath, bucketName, framePublisher);

      this.logger.log("Image ingestion completed.");
    } catch (error) {
      this.logger.error("Error during image ingestion:", error);
    }
  }

  private async uploadFiles(
    files: string[],
    targetDir: string,
    bucketName: string,
    framePublisher: FramePublisher
  ): Promise<void> {
    let fileCount = 0;

    for (const fullPath of files) {
      const file = path.basename(fullPath);
      const targetFilePath = path.join(targetDir, 'images/raw', file);
      const targetPreviewFilePath = path.join(targetDir, 'images/preview', file);

      if (!fs.lstatSync(fullPath).isDirectory()) {
        const { compressedImagePath, metadata } = await this.imageService.processImage(fullPath);
        // Upload file to MinIO
        const info = await this.storage.putObject(bucketName, targetFilePath, fullPath);
        const infoPrev = await this.storage.putObject(bucketName, targetPreviewFilePath, compressedImagePath);
        framePublisher?.recordFrameMetadata(fileCount++, file, targetFilePath, info, bucketName);
        framePublisher?.recordMediaMeta(metadata.width, metadata.height);
      }
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
    etag: string,
    bucket: string
  ) {
    try {
      // Create the frame object
      const frameObject = {
        id: path.basename(frameName, path.extname(frameName)),
        annotations: [],
        attr: {
          frame: frameNumber,
        },
        image: {
          path: `${frameName}`,
          size: [this.width, this.height],
        },
        sourceVideo: this.sourceVideo,
        sourceFrame: frameSource,
        etag,
        bucket
      };

      this.frames.push(frameObject);

      //console.log(`Frame metadata recorded for: ${frameName}`);
    } catch (err) {
      console.error("Error inserting frame:", err);
    }
  }

  public recordMediaMeta(width: number, height: number) {
    this.width = width;
    this.height = height;
  }

  public publishFrameMeta() {
    this.kafka.publishFrameUpdate(this.frames)
  }
}
