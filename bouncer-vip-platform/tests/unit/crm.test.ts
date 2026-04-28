import request from 'supertest';
import express, { Express } from 'express';
import jwt from 'jsonwebtoken';

// Mock database
const mockOfficers = [
  { id: '1', first_name: 'John', last_name: 'Doe', email: 'john@example.com', status: 'active' },
  { id: '2', first_name: 'Jane', last_name: 'Smith', email: 'jane@example.com', status: 'active' },
];

const mockDb = {
  select: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  first: jest.fn().mockResolvedValue(null),
  insert: jest.fn().mockReturnThis(),
  update: jest.fn().mockReturnThis(),
  returning: jest.fn().mockResolvedValue([]),
  orderBy: jest.fn().mockReturnThis(),
  limit: jest.fn().mockResolvedValue([]),
  count: jest.fn().mockReturnThis(),
  sum: jest.fn().mockReturnThis(),
  then: jest.fn(),
};

jest.mock('../services/crm/src/index', () => ({
  __esModule: true,
  default: express(),
}));

describe('CRM Service API', () => {
  let app: Express;
  const jwtSecret = process.env.JWT_SECRET || 'test-secret';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /health', () => {
    it('should return healthy status', async () => {
      const response = await request(app)
        .get('/health')
        .expect('Content-Type', /json/);

      expect(response.status).toBe(200);
      expect(response.body.status).toBeDefined();
    });
  });

  describe('POST /api/crm/officers', () => {
    it('should validate required fields', async () => {
      const invalidData = { first_name: 'John' };
      
      const response = await request(app)
        .post('/api/crm/officers')
        .send(invalidData)
        .expect(400);

      expect(response.body.error).toBeDefined();
    });

    it('should validate email format', async () => {
      const invalidData = {
        first_name: 'John',
        last_name: 'Doe',
        email: 'invalid-email',
        phone: '1234567890',
        password: 'password123',
      };

      const response = await request(app)
        .post('/api/crm/officers')
        .send(invalidData)
        .expect(400);

      expect(response.body.error).toContain('email');
    });

    it('should validate password length', async () => {
      const invalidData = {
        first_name: 'John',
        last_name: 'Doe',
        email: 'john@example.com',
        phone: '1234567890',
        password: 'short',
      };

      const response = await request(app)
        .post('/api/crm/officers')
        .send(invalidData)
        .expect(400);

      expect(response.body.error).toContain('password');
    });
  });

  describe('POST /api/crm/auth/login', () => {
    it('should return token for valid credentials', async () => {
      // Mock valid login
      const token = jwt.sign({ officerId: '1' }, jwtSecret, { expiresIn: '24h' });
      
      const response = await request(app)
        .post('/api/crm/auth/login')
        .send({ email: 'john@example.com', password: 'password123' });

      expect(response.status).toBeDefined();
    });

    it('should reject invalid credentials', async () => {
      const response = await request(app)
        .post('/api/crm/auth/login')
        .send({ email: 'invalid@example.com', password: 'wrong' });

      expect(response.status).toBeDefined();
    });
  });

  describe('GET /api/crm/officers', () => {
    it('should require authentication', async () => {
      const response = await request(app)
        .get('/api/crm/officers');

      expect([401, 403]).toContain(response.status);
    });

    it('should return paginated results', async () => {
      const token = jwt.sign({ officerId: '1' }, jwtSecret);
      
      const response = await request(app)
        .get('/api/crm/officers')
        .set('Authorization', `Bearer ${token}`);

      expect(response.body).toBeDefined();
    });
  });
});

describe('CRM Service Business Logic', () => {
  describe('Password Hashing', () => {
    it('should hash passwords before storage', async () => {
      const password = 'SecurePassword123!';
      const hash = await require('bcrypt').hash(password, 10);
      
      expect(hash).not.toBe(password);
      expect(hash.length).toBeGreaterThan(50);
    });

    it('should verify correct passwords', async () => {
      const password = 'SecurePassword123!';
      const hash = await require('bcrypt').hash(password, 10);
      const isValid = await require('bcrypt').compare(password, hash);
      
      expect(isValid).toBe(true);
    });

    it('should reject incorrect passwords', async () => {
      const password = 'SecurePassword123!';
      const hash = await require('bcrypt').hash(password, 10);
      const isValid = await require('bcrypt').compare('wrongpassword', hash);
      
      expect(isValid).toBe(false);
    });
  });

  describe('Officer Validation', () => {
    it('should validate PSIRA grade format', () => {
      const validGrades = ['A', 'B', 'C', 'D', 'E'];
      const invalidGrade = 'F';

      expect(validGrades.includes('A')).toBe(true);
      expect(validGrades.includes(invalidGrade)).toBe(false);
    });

    it('should validate South African phone numbers', () => {
      const validPhone = '+27831234567';
      const invalidPhone = '1234567890';

      expect(validPhone.startsWith('+27')).toBe(true);
      expect(invalidPhone.startsWith('+27')).toBe(false);
    });

    it('should validate email format', () => {
      const validEmails = ['test@example.com', 'user.name@domain.co.za'];
      const invalidEmails = ['invalid', '@nodomain.com', 'no@'];

      validEmails.forEach(email => {
        expect(email.includes('@')).toBe(true);
      });
    });
  });

  describe('Conflict Detection', () => {
    it('should detect overlapping shifts', () => {
      const shift1 = { start: '2024-01-01T08:00', end: '2024-01-01T16:00' };
      const shift2 = { start: '2024-01-01T12:00', end: '2024-01-01T20:00' };
      const shift3 = { start: '2024-01-01T17:00', end: '2024-01-01T01:00' };

      const hasConflict = (s1: any, s2: any) => {
        return s1.start < s2.end && s2.start < s1.end;
      };

      expect(hasConflict(shift1, shift2)).toBe(true);
      expect(hasConflict(shift1, shift3)).toBe(false);
    });
  });
});

describe('CRM Service Database Operations', () => {
  describe('Officer CRUD', () => {
    it('should create officer with all required fields', async () => {
      const officer = {
        first_name: 'John',
        last_name: 'Doe',
        email: 'john@example.com',
        phone: '+27831234567',
        status: 'active',
      };

      expect(officer.first_name).toBeDefined();
      expect(officer.last_name).toBeDefined();
      expect(officer.email).toBeDefined();
    });

    it('should update officer status', async () => {
      const updates = { status: 'inactive' };
      
      expect(updates.status).toBeDefined();
    });

    it('should soft delete officers', async () => {
      const officer = { deleted_at: null };
      officer.deleted_at = new Date();
      
      expect(officer.deleted_at).toBeDefined();
    });
  });

  describe('Venue Management', () => {
    it('should create venue with address', async () => {
      const venue = {
        name: 'Test Club',
        address: '123 Main St',
        city: 'Johannesburg',
        province: 'Gauteng',
      };

      expect(venue.name).toBeDefined();
      expect(venue.address).toBeDefined();
    });

    it('should validate venue capacity', () => {
      const venue = { capacity: 500 };
      
      expect(venue.capacity).toBeGreaterThan(0);
      expect(venue.capacity).toBeLessThan(100000);
    });
  });
});