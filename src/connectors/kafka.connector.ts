import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from "@nestjs/common";
import { Kafka, Admin, Producer } from "kafkajs";
import { ConfigService } from "@nestjs/config";

@Injectable()
export class KafkaConnector implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(KafkaConnector.name);
  private readonly kafka: Kafka;
  private readonly admin: Admin;
  private readonly producer: Producer;
  private readonly topics: string[] = ["annotation-dataset-update", "frame-update"]; // List of topics to create

  constructor(private configService: ConfigService) {
    const brokerUrl =
      this.configService.get<string>("KAFKA_BROKER_URL") || "localhost:9092";
    this.kafka = new Kafka({
      clientId: "sync-service",
      brokers: [brokerUrl],
    });
    this.admin = this.kafka.admin();
    this.producer = this.kafka.producer();
  }

  async onModuleInit() {
    try {
      await this.admin.connect();
      await this.producer.connect();
      await this.checkAndCreateTopics(); // Check and create all topics
    } catch (error) {
      this.logger.error(`Error during Kafka initialization: ${error.message}`);
    }
  }

  async onModuleDestroy() {
    await this.admin.disconnect();
    await this.producer.disconnect();
    this.logger.log("Kafka admin client disconnected.");
  }

  // Check and create all necessary topics
  private async checkAndCreateTopics(): Promise<void> {
    try {
      const existingTopics = await this.admin.listTopics();
      const newTopics = this.topics.filter(
        (topic) => !existingTopics.includes(topic)
      );

      if (newTopics.length > 0) {
        await this.createTopics(newTopics);
      } else {
        this.logger.log(`All topics already exist.`);
      }
    } catch (error) {
      this.logger.error(`Error checking topics: ${error.message}`);
    }
  }

  // Create multiple topics at once
  private async createTopics(topicNames: string[]): Promise<void> {
    try {
      const topicConfigs = topicNames.map((topicName) => ({
        topic: topicName,
        numPartitions: 1,
        replicationFactor: 1,
      }));

      await this.admin.createTopics({ topics: topicConfigs });
      this.logger.log(
        `Topics [${topicNames.join(", ")}] created successfully.`
      );
    } catch (error) {
      this.logger.error(`Failed to create topics: ${error.message}`);
    }
  }

  // Generalized function to publish messages to any topic
  private async publishMessage(topic: string, message: any): Promise<void> {
    try {
      await this.producer.send({
        topic,
        messages: [{ value: JSON.stringify(message) }],
      });
      this.logger.log(
        `Message sent to Kafka topic '${topic}': ${JSON.stringify(message)}`
      );
    } catch (error) {
      this.logger.error(
        `Failed to send message to topic '${topic}': ${error.message}`
      );
    }
  }

  // Specific function to publish annotation source (uses publishMessage under the hood)
  async publishAnnotationUpdate(annotationData: any): Promise<void> {
    await this.publishMessage("annotation-dataset-update", annotationData);
  }

  // Specific function to publish account data (uses publishMessage under the hood)
  async publishFrameUpdate(frameData: any): Promise<void> {
    await this.publishMessage("frame-update", frameData); 
  }
}
