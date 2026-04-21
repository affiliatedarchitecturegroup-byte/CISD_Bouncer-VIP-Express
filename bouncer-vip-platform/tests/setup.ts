import { Knex } from 'knex';
import knexConfig from '../services/crm/knexfile';

export const globalSetup = async (): Promise<void> => {
  // Setup test database
};

export const globalTeardown = async (): Promise<void> => {
  // Cleanup after all tests
};

export const setupFilesAfterEnv = [
  '<rootDir>/tests/setup.ts',
];

// Mock NATS
jest.mock('nats', () => ({
  connect: jest.fn().mockResolvedValue({
    close: jest.fn(),
    jetstream: jest.fn().mockReturnValue({
      publish: jest.fn().mockResolvedValue(undefined),
      subscribe: jest.fn().mockReturnValue({
        unsubscribe: jest.fn(),
      }),
    }),
  }),
}));

// Mock Redis
jest.mock('redis', () => ({
  createClient: jest.fn().mockReturnValue({
    connect: jest.fn(),
    quit: jest.fn(),
    on: jest.fn(),
    incr: jest.fn(),
    expire: jest.fn(),
    get: jest.fn(),
    set: jest.fn(),
  }),
}));

// Mock database
const mockDb = {
  raw: jest.fn().mockResolvedValue([]),
  select: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  first: jest.fn().mockResolvedValue(null),
  insert: jest.fn().mockReturnThis(),
  update: jest.fn().mockReturnThis(),
  delete: jest.fn().mockReturnThis(),
  orderBy: jest.fn().mockReturnThis(),
  limit: jest.fn().mockReturnThis(),
  count: jest.fn().mockReturnThis(),
  sum: jest.fn().mockReturnThis(),
  avg: jest.fn().mockReturnThis(),
  join: jest.fn().mockReturnThis(),
  leftJoin: jest.fn().mockReturnThis(),
  groupBy: jest.fn().mockReturnThis(),
  having: jest.fn().mockReturnThis(),
  returning: jest.fn().mockResolvedValue([]),
  destroy: jest.fn(),
};

jest.mock('knex', () => {
  const knex = jest.fn().mockReturnValue(mockDb);
  (knex as any).raw = mockDb.raw;
  return { default: knex };
});

beforeAll(() => {
  process.env.NODE_ENV = 'test';
  process.env.PORT = '3001';
});

afterAll(async () => {
  // Cleanup
});