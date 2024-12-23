import { Injectable, Logger } from "@nestjs/common";
import * as ffmpeg from "fluent-ffmpeg";
import * as fs from "fs";
import * as path from "path";
import { promises as fsPromises } from "fs";
import { FramePublisher } from "./ingest.service";

@Injectable()
export class VideoService {
  private readonly logger = new Logger(VideoService.name);

  async extractMetadata(filePath: string): Promise<any> {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(filePath, (err, metadata) => {
        if (err) {
          reject(err);
        } else {
          const videoStream = metadata.streams.find(
            (stream) => stream.codec_type === "video"
          );
          if (videoStream) {
            const xMetadata = {
              length: metadata.format.duration,
              bitRate: metadata.format.bit_rate,
              codec: videoStream.codec_name,
              fps: eval(videoStream.avg_frame_rate),
              numberOfFrames: videoStream.nb_frames,
              width: videoStream.width,
              height: videoStream.height,
              quality: null,
            };

            xMetadata.quality = this.evaluateFrameQuality(xMetadata);

            resolve(xMetadata);
          } else {
            reject(new Error("No video stream found"));
          }
        }
      });
    });
  }

  async cutSelections(
    sourcePath: string,
    destinationPath: string,
    selections: { from: number; to: number }[]
  ): Promise<void> {
    this.ensureDirectoryExists(destinationPath);

    return new Promise((resolve, reject) => {
      if (!selections || selections.length === 0) {
        // If no selections, simply copy the source file to the destination
        fs.copyFile(sourcePath, destinationPath, (err) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        });
        return;
      }

      const tempFiles = [];
      let segmentIndex = 0;

      const processSegment = (from, to, callback) => {
        const fileName = path.basename(sourcePath);
        const tempFile = `./tmp/temp_${fileName}_segment_${segmentIndex}.mp4`;
        this.ensureDirectoryExists(tempFile);
        tempFiles.push(tempFile);

        ffmpeg(sourcePath)
          .inputOptions(`-ss ${from}`)
          .inputOptions(`-t ${to - from}`)
          .outputOptions("-c copy")
          .output(tempFile)
          .on("end", () => {
            segmentIndex++;
            callback();
          })
          .on("error", (err) => {
            console.error("Error during processing:", err);
            reject(err);
          })
          .run();
      };

      const processSelections = (index) => {
        if (index < selections.length) {
          const { from, to } = selections[index];
          processSegment(from, to, () => processSelections(index + 1));
        } else {
          concatenateSegments();
        }
      };

      const concatenateSegments = () => {
        const command = ffmpeg();

        tempFiles.forEach((tempFile) => {
          command.input(tempFile);
        });

        command
          .on("end", () => {
            // Clean up temporary files
            tempFiles.forEach((file) => fs.unlinkSync(file));
            console.log("Processing finished successfully");
            resolve();
          })
          .on("error", (err) => {
            console.error("Error during concatenation:", err);
            reject(err);
          })
          .mergeToFile(destinationPath);
      };

      processSelections(0);
    });
  }

  async videoFragmentation(
    videoFile: string,
    outputDir: string,
    outputType: "lossless" | "preview",
    publisher: FramePublisher
  ): Promise<string> {
    const metadata = await this.extractMetadata(videoFile);
    
    publisher?.recordVideoMeta(
      metadata.width,
      metadata.height
    );
    
    const absolutePath = path.resolve(videoFile);

    // Create output directory for frames
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    return new Promise((resolve, reject) => {
      const ffmpegCommand = ffmpeg(absolutePath)
        .on("progress", (progress: any) => 
          console.log("Progress:", progress)
        )
        .on("start", (cmdline) => {
          console.log("Started ffmpeg with command:", cmdline);
        })
        .on("end", () => {
          console.log("Frames successfully created");
          resolve("Frames extracted successfully");
        })
        .on("error", (err) => {
          console.error("Error while extracting frames:", err);
          reject(new Error(`Error extracting frames: ${err.message}`));
        });

      if (outputType === "lossless") {
        // Extract high-quality PNG frames
        ffmpegCommand
          .output(`${outputDir}/frame_%06d.png`)
          .outputOptions(["-vsync 0", "-start_number 0"]); // Add lossless-specific options if needed
      } else if (outputType === "preview") {
        // Extract lower-quality JPEG frames for browser preview
        ffmpegCommand
          .output(`${outputDir}/frame_%06d.jpg`)
          .outputOptions("-q:v 5") // Lower quality for smaller file size
          .outputOptions("-start_number 0"); // Add browser-preview-specific options
      } else {
        reject(new Error(`Invalid outputType: ${outputType}`));
        return;
      }

      ffmpegCommand.run();
    });
  }

  private ensureDirectoryExists(filePath: string): boolean {
    const dirname = path.dirname(filePath);
    if (fs.existsSync(dirname)) {
      return true;
    }
    fs.mkdirSync(dirname, { recursive: true });
    return true;
  }

  private evaluateFrameQuality(metadata: any): any {
    const qualityCriteria = {
      bitRatePerFrame: {
        "1080p": { high: 0.5, medium: 0.25, low: 0.1 }, // Mbps per frame for 1080p
        "720p": { high: 0.3, medium: 0.15, low: 0.08 }, // Mbps per frame for 720p
        "480p": { high: 0.15, medium: 0.08, low: 0.04 }, // Mbps per frame for 480p
      },
      resolution: {
        "1080p": { width: 1920, height: 1080, standardBitrate: 8000000 }, // Standard bitrate in bps
        "720p": { width: 1280, height: 720, standardBitrate: 5000000 },
        "480p": { width: 640, height: 480, standardBitrate: 2500000 },
      },
      codecs: ["h264", "hevc"],
    };

    let qualityScore = 0;
    let qualityDescription = "";

    // Determine resolution category
    let resolutionCategory = "480p";
    if (
      metadata.width >= qualityCriteria.resolution["1080p"].width &&
      metadata.height >= qualityCriteria.resolution["1080p"].height
    ) {
      resolutionCategory = "1080p";
    } else if (
      metadata.width >= qualityCriteria.resolution["720p"].width &&
      metadata.height >= qualityCriteria.resolution["720p"].height
    ) {
      resolutionCategory = "720p";
    }

    // Calculate bit rate per frame (in Mbps)
    const bitRatePerFrame = metadata.bitRate / 1000000 / metadata.fps;

    // Evaluate bit rate per frame based on resolution category
    if (
      bitRatePerFrame >=
      qualityCriteria.bitRatePerFrame[resolutionCategory].high
    ) {
      qualityScore += 3;
    } else if (
      bitRatePerFrame >=
      qualityCriteria.bitRatePerFrame[resolutionCategory].medium
    ) {
      qualityScore += 2;
    } else if (
      bitRatePerFrame >= qualityCriteria.bitRatePerFrame[resolutionCategory].low
    ) {
      qualityScore += 1;
    }

    // Evaluate codec
    if (qualityCriteria.codecs.includes(metadata.codec)) {
      qualityScore += 1;
    }

    // Evaluate overall bitrate against standard bitrate for resolution
    const standardBitrate =
      qualityCriteria.resolution[resolutionCategory].standardBitrate;
    const bitrateRatio = metadata.bitRate / standardBitrate;
    if (bitrateRatio >= 1) {
      qualityScore += 2; // High quality if bitrate is at or above standard
    } else if (bitrateRatio >= 0.75) {
      qualityScore += 1; // Medium quality if bitrate is moderately below standard
    }

    // Determine quality description
    if (qualityScore >= 6) {
      qualityDescription = "High";
    } else if (qualityScore >= 3) {
      qualityDescription = "Medium";
    } else {
      qualityDescription = "Low";
    }

    return {
      qualityScore,
      qualityDescription,
      bitRatePerFrame,
      bitrateRatio,
    };
  }

  async deleteFile(filePath: string): Promise<void> {
    await fsPromises.unlink(filePath);
    this.logger.log(`File ${filePath} deleted successfully`);
  }

  async cleanupDirectory(dir: string): Promise<void> {
    try {
      const files = await fsPromises.readdir(dir);
      await Promise.all(
        files.map((file) => fsPromises.unlink(path.join(dir, file)))
      );
      await fsPromises.rmdir(dir);
      this.logger.log(`Deleted all files and directory: ${dir}`);
    } catch (err) {
      this.logger.error(
        `Error while cleaning up output directory: ${err.message}`
      );
    }
  }
}
