import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { SObject, SObjectSchema } from './schemas/sobject.schema';
import { Tag, TagSchema } from './schemas/tag.schema';
import { ClientsModule } from '@nestjs/microservices';
import { MinioConnector } from './connectors/minio.connector';
import { KafkaConnector } from './connectors/kafka.connector';
import { VideoService } from './services/video.service';
import { StorageController } from './storage.controller';
import { MetaController } from './smeta/smeta.controller';
import { StorageService } from './services/storage.service';
import { TagService } from './tags/tag.service';
import { TagController } from './tags/tag.controller';
import { IngestService } from './services/ingest.service';
import { ZipFileProcessorService } from './services/zipfile.service';
import { ScheduleModule } from '@nestjs/schedule';
import { grpcOptionsFactory, kafkaOptionsFactory, mongooseOptionsFactory, minioClientFactory, grpcAuthOptionsFactory, s3ClientFactory } from './storage.config';
import { AuthGuard } from './auth/auth.guard.rpc';
import { S3Connector } from './connectors/s3.connector';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: `.env.${process.env.NODE_ENV}`, 
    }),
    // Mongoose configuration using async factory
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: mongooseOptionsFactory,
    }),
    // Mongoose schema registration
    MongooseModule.forFeature([
      { name: SObject.name, schema: SObjectSchema },
      { name: Tag.name, schema: TagSchema },
    ]),
    // Registering gRPC service
    ClientsModule.registerAsync([
      {
        name: 'SMETA_PACKAGE',
        useFactory: grpcOptionsFactory,
        inject: [ConfigService],
      },
    ]),
    ClientsModule.registerAsync([
      {
        name: 'AUTH_PACKAGE',
        useFactory: grpcAuthOptionsFactory,
        inject: [ConfigService],
      },
    ]),
    // Registering Kafka service
    ClientsModule.registerAsync([
      {
        name: 'KAFKA_SERVICE',
        useFactory: kafkaOptionsFactory,
        inject: [ConfigService],
      },
    ]),
  ],
  controllers: [StorageController, MetaController, TagController],
  providers: [
    ZipFileProcessorService,
    KafkaConnector,
    StorageService,
    VideoService,
    IngestService,
    TagService,
    AuthGuard,
    {
      provide: 'S3_CLIENT',
      useFactory: s3ClientFactory,
      inject: [ConfigService],
    },
    {
      provide: 'StorageConnector', 
      useClass: S3Connector, 
    },
  ],
  exports: ['S3_CLIENT', 'StorageConnector', VideoService], // Export the client for use in other services
})
export class StorageModule {}