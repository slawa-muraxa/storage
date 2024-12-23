import { Transport, GrpcOptions, KafkaOptions } from '@nestjs/microservices';
import { join } from 'path';
import { ConfigService } from '@nestjs/config';
import { ReflectionService } from '@grpc/reflection';
import { MongooseModuleOptions } from '@nestjs/mongoose';
import * as mongoose from 'mongoose';
import { Client as MinioClient } from 'minio';
import { S3Client } from '@aws-sdk/client-s3';

// GrpcOptions Factory
export const grpcOptionsFactory = async (configService: ConfigService): Promise<GrpcOptions> => {
  const grpcPort = configService.get<number>('GRPC_PORT') || 53004; // Use GRPC_PORT from .env or default to 53004

  return {
    transport: Transport.GRPC,
    options: {
      package: 'storage', // Match this with your proto package name
      protoPath: join(__dirname, 'storage.proto'), // Adjust the path as necessary
      url: `0.0.0.0:${grpcPort}`, // Set the gRPC server to listen on a different port
      onLoadPackageDefinition: (pkg, server) => {
        new ReflectionService(pkg).addToServer(server); // Enable gRPC reflection for service discovery
      },
    },
  };
};

// GrpcOptions Factory
export const grpcAuthOptionsFactory = async (configService: ConfigService): Promise<GrpcOptions> => {
  const authGrpcHost = configService.get<string>('AUTH_GRPC') || "localhost:53001"; // Use GRPC_PORT from .env or default to 53004

  return {
    transport: Transport.GRPC,
    options: {
      package: 'auth',
      protoPath: join(__dirname, 'auth/auth.proto'),
      url: authGrpcHost,
    },
  };
};

// KafkaOptions Factory
export const kafkaOptionsFactory = async (configService: ConfigService): Promise<KafkaOptions> => {
  const brokers = configService.get<string>('KAFKA_BROKER_URL').split(','); // Get brokers from .env
  const clientId = 'storage-consumer';
  const groupId = 'storage-consumer-group'; // Default groupId for the Kafka consumer
  return {
    transport: Transport.KAFKA,
    options: {
      client: {
        clientId,
        brokers, // Set the brokers from the configuration
      },
      consumer: {
        groupId, // Set the consumer group ID
      },
    },
  };
};

// MongooseOptions Factory
export const mongooseOptionsFactory = async (configService: ConfigService): Promise<MongooseModuleOptions> => {
  const debug = configService.get<boolean>('DEBUG') || false;
  mongoose.set('debug', debug); // Enable Mongoose debug mode
  const mongo_uri = configService.get<string>('MONGO_URI') || 'mongodb://localhost:37017';
  const db_name = configService.get<string>('DB_NAME') || 'storage';
  return {
    uri: `${mongo_uri}/${db_name}`, // Use the MONGO_URI from the .env file
  };
};

export const minioClientFactory = async (configService: ConfigService): Promise<MinioClient> => {
  const endPoint = configService.get<string>('STORAGE_ENDPOINT', 'localhost');
  const port = parseInt(configService.get<string>('STORAGE_PORT', '9000'), 10);
  const useSSL = configService.get<string>('STORAGE_USE_SSL', 'false') === 'true'; // Convert string to boolean
  const accessKey = configService.get<string>('STORAGE_ACCESS_KEY', 'admin');
  const secretKey = configService.get<string>('STORAGE_SECRET_KEY', 'adminadmin12');

  console.log('MinIO Client Config:', { endPoint, port, useSSL, accessKey, secretKey });

  try {
    return new MinioClient({
      endPoint,
      port,
      useSSL,
      accessKey,
      secretKey,
    });
  } catch (error) {
    console.error('Error initializing MinIO client:', error);
    throw error;
  }
};

// Factory method for creating S3Client instance
export const s3ClientFactory = async (configService: ConfigService): Promise<S3Client> => {
  const endPoint = configService.get<string>('STORAGE_ENDPOINT', 'localhost');
  const port = parseInt(configService.get<string>('STORAGE_PORT', '9000'), 10);
  const useSSL = configService.get<string>('STORAGE_USE_SSL', 'false') === 'true';
  const accessKey = configService.get<string>('STORAGE_ACCESS_KEY', 'admin');
  const secretKey = configService.get<string>('STORAGE_SECRET_KEY', 'adminadmin12');

  console.log('MinIO Client Config:', { endPoint, port, useSSL, accessKey, secretKey });

  try {

      // Create an S3Client instance 
      const s3Client = new S3Client({
          region: 'us-west-1', // Example region, can be configured based on your needs
          endpoint: `http${useSSL ? 's' : ''}://${endPoint}:${port}`,
          credentials: {
              accessKeyId: accessKey,
              secretAccessKey: secretKey,
          },
          forcePathStyle: true, // MinIO requires path-style URLs
      });

      console.log('S3 Client Created Successfully.');
      return s3Client;
  } catch (error) {
      console.error('Error creating S3Client:', error);
      throw error;
  }
};