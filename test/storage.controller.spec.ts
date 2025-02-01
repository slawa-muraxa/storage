import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication, HttpStatus } from "@nestjs/common";
import * as request from "supertest";
import { StorageModule } from "../src/storage.module"; // Replace with the actual module containing your controller
import * as dotenv from "dotenv";
import { Types } from "mongoose";
import { StorageService } from "../src/services/storage.service";

dotenv.config({ path: "./.env.dev" }); // Load the dev.env for this test

describe("MinIOController (Integration)", () => {
  let app: INestApplication;

  // Helper function to create mock Mongoose documents
  const createMockDocument = (data: any) => {
    // Mock the Mongoose Document structure
    const mockDoc: any = {
      ...data,
      save: jest.fn().mockResolvedValue(data), // Mock the save method
      toObject: jest.fn().mockReturnValue(data), // Simulate the toObject method
      _id: new Types.ObjectId(), // Mock the ObjectId
    };
    return mockDoc;
  };

  const mockStorageConnector = {
    // Mock for listAllObjects, which handles multiple buckets
    listAllObjects: jest.fn().mockImplementation((bucket) => {
      // Generate unique objects based on the bucket name
      const objectData = {
        "l1-raw": [
          {
            id: "1",
            bucket: "l1-raw",
            name: "l1-raw-file1.txt",
            active: true,
            metadata: {},
          },
          {
            id: "2",
            bucket: "l1-raw",
            name: "l1-raw-file2.txt",
            active: true,
            metadata: {},
          },
        ],
        "l2-prep": [
          {
            id: "3",
            bucket: "l2-prep",
            name: "l2-prep-file1.txt",
            active: true,
            metadata: {},
          },
          {
            id: "4",
            bucket: "l2-prep",
            name: "l2-prep-file2.txt",
            active: true,
            metadata: {},
          },
        ],
        "l3-rel": [
          {
            id: "5",
            bucket: "l3-rel",
            name: "l3-rel-file1.txt",
            active: true,
            metadata: {},
          },
          {
            id: "6",
            bucket: "l3-rel",
            name: "l3-rel-file2.txt",
            active: true,
            metadata: {},
          },
        ],
      };
      return Promise.resolve(objectData[bucket] || []); // Return the objects based on the bucket name
    }),
  };

  const mockStorageService = {
    // Mocking the method that updates bucket data
    updateBucketData: jest.fn().mockResolvedValue(true),

    // Mocking the method that retrieves all active objects
    getAllActiveObjects: jest.fn().mockResolvedValue([
      // Reflecting the SObject schema, but returning mock Mongoose documents
      createMockDocument({
        bucket: "l1-raw",
        name: "l1-raw-file1.txt",
        active: true,
      }),
      createMockDocument({
        bucket: "l2-prep",
        name: "l2-prep-file1.txt",
        active: true,
      }),
    ]),
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [StorageModule],
    })
      .overrideProvider("StorageConnector") // Replace with your actual service token
      .useValue(mockStorageConnector)
      .overrideProvider(StorageService) // Replace with your actual service token
      .useValue(mockStorageService)
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks(); // Or jest.resetAllMocks() if you want to reset implementations
  });

  it("/sync-minio-structure (GET) - Success", async () => {
    const response = await request(app.getHttpServer())
      .get("/api/sync-minio-structure")
      .set("Authorization", "Bearer valid_token");

    expect(response.status).toBe(HttpStatus.OK);
    expect(response.body).toEqual({
      "l1-raw": [{ name: "l1-raw-file1.txt", "active": true }],
      "l2-prep": [{ name: "l2-prep-file1.txt", "active": true }],
    });

    expect(mockStorageConnector.listAllObjects).toHaveBeenCalledTimes(3);
    expect(mockStorageService.updateBucketData).toHaveBeenCalledTimes(1);
    expect(mockStorageService.getAllActiveObjects).toHaveBeenCalledTimes(1);
  });

  it("/sync-minio-structure (GET) - Error", async () => {
    mockStorageConnector.listAllObjects.mockRejectedValueOnce(
      new Error("MinIO Service Error")
    );

    const response = await request(app.getHttpServer())
      .get("/api/sync-minio-structure")
      .set("Authorization", "Bearer valid_token");

    expect(response.status).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(response.body).toEqual({ error: "MinIO Service Error" });

    expect(mockStorageConnector.listAllObjects).toHaveBeenCalledTimes(3);
  });
});
