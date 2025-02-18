import { Inject, Injectable, Logger } from "@nestjs/common";
import { VideoService } from "./video.service";
import { StorageConnector } from "../connectors/storage.connector";
import { StorageService } from "../services/storage.service";
import { LineageService, LinkType } from "../services/lineage.service";
import { KafkaConnector } from "../connectors/kafka.connector";
import { ServiceName } from "../schemas/sobject.schema";
import * as path from "path";
import * as fs from "fs";

@Injectable()
export class IngestService {
  private readonly logger = new Logger(IngestService.name);

  constructor(
    private readonly videoService: VideoService,
    private readonly storageService: StorageService,
    private readonly lineage: LineageService,
    @Inject('StorageConnector') private readonly storage: StorageConnector,
    private readonly kafka: KafkaConnector
  ) { }

  /**
   * Initializes the ingestion process for a given task.
   * @param task Task details including project ID and name.
   * @param sourcePath Path to the source video file.
   */
  async videoToDatalake(
    objectName: string,
    sourcePath: string,
    logger: (message: string, progress: number) => void
  ): Promise<void> {
    const objectBasename = `${path.basename(objectName)}`;
    const tmpDir = path.join("tmp/muraxa/frames", objectName);
    const tmpImages = path.join(tmpDir, "raw");
    const tmpPreviewImages = path.join(tmpDir, "preview");
    const storagePath = `${objectName}/images/default`;
    const previewStoragePath = `${objectName}/images/preview`;
    const frameObjectLinkPath = `${objectName}/${objectBasename}.link`;

    try {
      this.logger.debug(`Starting ingestion for: ${objectName}`);

      const framePublisher: FramePublisher = new FramePublisher(objectName, this.kafka)

      // Fragment video and store frames in temporary directory
      logger("Creating raw frames ...", 60);
      await this.videoService.videoFragmentation(sourcePath, tmpImages, "lossless", framePublisher);
      logger("Uploading raw frames ...", 70);
      await this.ingestImages(tmpImages, storagePath, "l4-dl", framePublisher);
      await this.videoService.cleanupDirectory(tmpImages);

      // Fragment video and store frames in temporary directory
      logger("Creating preview frames ...", 80);
      await this.videoService.videoFragmentation(sourcePath, tmpPreviewImages, "preview", null);
      logger("Uploading preview frames ...", 90);
      await this.ingestImages(tmpPreviewImages, previewStoragePath, "l4-dl", null);
      await this.videoService.cleanupDirectory(tmpPreviewImages);

      // Establishing lineage
      const dlObject = await this.storage.putTextObject(frameObjectLinkPath, `${objectName}`, 'l4-dl');
      const dlDbObject = {
        id: frameObjectLinkPath,
        bucket: "l4-dl",
        name: frameObjectLinkPath,
        etag: dlObject.ETag,
        size: dlObject.Size,
        active: true,
      }
      await this.storageService.initObject(dlDbObject);
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

      framePublisher.publishFrameMeta();

      this.logger.debug(`Completed ingestion for task ${objectName}`);
    } catch (error) {
      this.logger.error(`Error during ingestion for task ${objectName}`, error);
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
          const info = await this.storage.putObject(bucketName, targetFilePath, fullPath);
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
    etag: string,
    bucket: string
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

      //console.log(`Frame metadata recorded for: ${frameName}`);
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
