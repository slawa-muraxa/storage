import { Test, TestingModule } from '@nestjs/testing';
import { StorageService } from '../src/services/storage.service';
import mongoose, { Connection } from 'mongoose';

describe('StorageService', () => {
  let service: StorageService;
  let mockConnection: Partial<Connection>;

  const mockModel = {
    updateOne: jest.fn(),
    find: jest.fn(),
    findOneAndUpdate: jest.fn(),
  };

  beforeEach(async () => {
    // Mock the Mongoose connection
    mockConnection = {
      model: jest.fn().mockReturnValue(mockModel),
      db: {
        listCollections: jest.fn().mockReturnValue({
          toArray: jest.fn().mockResolvedValue([
            { name: 'storage.l1-raw.objects' },
            { name: 'storage.l2-prep.objects' },
          ]),
        }),
      },
    } as unknown as Connection;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StorageService,
        {
          provide: 'DatabaseConnection',
          useValue: mockConnection,
        },
      ],
    }).compile();

    service = module.get<StorageService>(StorageService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should update bucket data correctly', async () => {
    mockModel.updateOne.mockResolvedValueOnce({ modifiedCount: 1 });

    const bucketData = [
      {
        bucket: 'l1-raw',
        objects: [{ name: 'file1.txt', active: true }],
      },
    ];

    await service.updateBucketData(bucketData);

    expect(mockConnection.model).toHaveBeenCalledWith(
      'storage.l1-raw.objects',
      expect.anything(),
      'storage.l1-raw.objects',
    );
    expect(mockModel.updateOne).toHaveBeenCalledWith(
      { id: 'file1.txt' },
      { name: 'file1.txt', active: true, bucket: 'l1-raw' },
      { upsert: true },
    );
  });

  it('should fetch all active objects correctly', async () => {
    mockModel.find.mockResolvedValue([{ id: '1', name: 'file1.txt', active: true }]);

    const result = await service.getAllActiveObjects();

    expect(mockConnection.db.listCollections).toHaveBeenCalled();
    expect(mockConnection.model).toHaveBeenCalledWith(
      'storage.l1-raw.objects',
      expect.anything(),
      'storage.l1-raw.objects',
    );
    expect(mockModel.find).toHaveBeenCalledWith({ active: true });
    expect(result).toEqual([{ id: '1', name: 'file1.txt', active: true }, { id: '1', name: 'file1.txt', active: true }]);
  });
});