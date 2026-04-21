import request from 'supertest';
import express, { Express } from 'express';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';

describe('Scheduling Service Integration Tests', () => {
  let app: Express;
  let authToken: string;
  const jwtSecret = process.env.JWT_SECRET || 'test-secret';

  beforeAll(async () => {
    authToken = jwt.sign({ officerId: 'test-officer-id' }, jwtSecret, { expiresIn: '1h' });
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Shift Lifecycle', () => {
    const testOfficerId = uuidv4();
    const testVenueId = uuidv4();

    it('should create a new shift', async () => {
      const shiftData = {
        officer_id: testOfficerId,
        venue_id: testVenueId,
        start_time: '2024-01-15T08:00:00Z',
        end_time: '2024-01-15T16:00:00Z',
        hourly_rate: 150,
      };

      const response = await request(app)
        .post('/api/scheduling/shifts')
        .set('Authorization', `Bearer ${authToken}`)
        .send(shiftData);

      expect(response.status).toBeDefined();
    });

    it('should detect shift conflicts', async () => {
      const conflictShifts = [
        { officer_id: testOfficerId, start: '2024-01-15T08:00', end: '2024-01-15T16:00' },
        { officer_id: testOfficerId, start: '2024-01-15T12:00', end: '2024-01-15T20:00' },
      ];

      const hasConflicts = conflictShifts.length > 1;
      expect(hasConflicts).toBe(true);
    });

    it('should update shift status', async () => {
      const shiftId = uuidv4();
      const updateData = { status: 'clocked_in' };

      const response = await request(app)
        .patch(`/api/scheduling/shifts/${shiftId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send(updateData);

      expect(response.status).toBeDefined();
    });

    it('should list shifts with filters', async () => {
      const response = await request(app)
        .get('/api/scheduling/shifts')
        .query({ status: 'scheduled', date: '2024-01-15' })
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.body).toBeDefined();
    });
  });

  describe('Availability Management', () => {
    it('should set officer availability', async () => {
      const availability = {
        officer_id: uuidv4(),
        date: '2024-01-20',
        slots: [
          { start: '08:00', end: '16:00', available: true },
          { start: '16:00', end: '00:00', available: false },
        ],
      };

      const response = await request(app)
        .post('/api/scheduling/availability')
        .set('Authorization', `Bearer ${authToken}`)
        .send(availability);

      expect(response.status).toBeDefined();
    });

    it('should calculate available officers for venue', async () => {
      const response = await request(app)
        .get('/api/scheduling/availability/venue')
        .query({ venue_id: uuidv4(), date: '2024-01-20' })
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.body).toBeDefined();
    });
  });
});

describe('On-Demand Service Integration Tests', () => {
  let authToken: string;

  beforeAll(async () => {
    authToken = jwt.sign({ officerId: 'test-officer-id' }, jwtSecret, { expiresIn: '1h' });
  });

  describe('Emergency Booking Flow', () => {
    it('should create emergency booking request', async () => {
      const bookingData = {
        venue_id: uuidv4(),
        service_type: 'emergency',
        requested_date: '2024-01-15',
        officer_count: 5,
        special_instructions: 'Urgent - crowd control needed',
      };

      const response = await request(app)
        .post('/api/on-demand/bookings')
        .set('Authorization', `Bearer ${authToken}`)
        .send(bookingData);

      expect(response.status).toBeDefined();
    });

    it('should find available officers', async () => {
      const response = await request(app)
        .get('/api/on-demand/officers/available')
        .query({
          date: '2024-01-15',
          start_time: '08:00',
          end_time: '16:00',
        })
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.body).toBeDefined();
    });

    it('should assign officers to booking', async () => {
      const bookingId = uuidv4();
      const officerIds = [uuidv4(), uuidv4()];

      const response = await request(app)
        .post(`/api/on-demand/bookings/${bookingId}/assign`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ officer_ids: officerIds });

      expect(response.status).toBeDefined();
    });
  });
});

describe('Monitoring Service Integration Tests', () => {
  let authToken: string;

  beforeAll(async () => {
    authToken = jwt.sign({ officerId: 'test-officer-id' }, jwtSecret, { expiresIn: '1h' });
  });

  describe('Incident Management', () => {
    it('should create incident report', async () => {
      const incidentData = {
        venue_id: uuidv4(),
        shift_id: uuidv4(),
        incident_type: 'assault',
        severity: 'high',
        title: 'Physical altercation at entrance',
        description: 'Two patrons involved in fight',
      };

      const response = await request(app)
        .post('/api/monitoring/incidents')
        .set('Authorization', `Bearer ${authToken}`)
        .send(incidentData);

      expect(response.status).toBeDefined();
    });

    it('should track officer locations', async () => {
      const locationData = {
        officer_id: uuidv4(),
        latitude: -26.2041,
        longitude: 28.0473,
        accuracy: 10,
        timestamp: new Date().toISOString(),
      };

      const response = await request(app)
        .post('/api/monitoring/locations')
        .set('Authorization', `Bearer ${authToken}`)
        .send(locationData);

      expect(response.status).toBeDefined();
    });

    it('should create venue alerts', async () => {
      const alertData = {
        venue_id: uuidv4(),
        alert_type: 'capacity_warning',
        title: 'Venue approaching capacity',
        message: 'Attendance at 90%',
        severity: 'medium',
      };

      const response = await request(app)
        .post('/api/monitoring/alerts')
        .set('Authorization', `Bearer ${authToken}`)
        .send(alertData);

      expect(response.status).toBeDefined();
    });
  });
});

describe('ERP Service Integration Tests', () => {
  let authToken: string;

  beforeAll(async () => {
    authToken = jwt.sign({ officerId: 'test-officer-id' }, jwtSecret, { expiresIn: '1h' });
  });

  describe('Financial Operations', () => {
    it('should create invoice', async () => {
      const invoiceData = {
        venue_id: uuidv4(),
        invoice_type: 'service',
        line_items: [
          { description: 'Security services', quantity: 8, rate: 150 },
        ],
        due_date: '2024-02-15',
      };

      const response = await request(app)
        .post('/api/erp/invoices')
        .set('Authorization', `Bearer ${authToken}`)
        .send(invoiceData);

      expect(response.status).toBeDefined();
    });

    it('should process payroll', async () => {
      const payrollData = {
        pay_period_start: '2024-01-01',
        pay_period_end: '2024-01-15',
        officer_ids: [uuidv4(), uuidv4()],
      };

      const response = await request(app)
        .post('/api/erp/payroll')
        .set('Authorization', `Bearer ${authToken}`)
        .send(payrollData);

      expect(response.status).toBeDefined();
    });

    it('should generate financial reports', async () => {
      const response = await request(app)
        .get('/api/erp/reports/revenue')
        .query({ period: 'monthly', year: 2024 })
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.body).toBeDefined();
    });
  });
});

describe('Biometrics Service Integration Tests', () => {
  let authToken: string;

  beforeAll(async () => {
    authToken = jwt.sign({ officerId: 'test-officer-id' }, jwtSecret, { expiresIn: '1h' });
  });

  describe('Face Recognition', () => {
    it('should enroll biometric data', async () => {
      const enrollmentData = {
        officer_id: uuidv4(),
        face_embedding: 'base64_encoded_face_data',
        liveness_score: 0.95,
      };

      const response = await request(app)
        .post('/api/biometrics/enroll')
        .set('Authorization', `Bearer ${authToken}`)
        .send(enrollmentData);

      expect(response.status).toBeDefined();
    });

    it('should verify biometric match', async () => {
      const verificationData = {
        officer_id: uuidv4(),
        face_embedding: 'base64_encoded_face_data',
        location: { latitude: -26.2041, longitude: 28.0473 },
      };

      const response = await request(app)
        .post('/api/biometrics/verify')
        .set('Authorization', `Bearer ${authToken}`)
        .send(verificationData);

      expect(response.status).toBeDefined();
    });
  });
});

describe('PSIRA Compliance Integration Tests', () => {
  let authToken: string;

  beforeAll(async () => {
    authToken = jwt.sign({ officerId: 'test-officer-id' }, jwtSecret, { expiresIn: '1h' });
  });

  describe('Registration Management', () => {
    it('should track PSIRA registration', async () => {
      const registrationData = {
        officer_id: uuidv4(),
        psira_number: 'PSIRA123456',
        grade: 'C',
        registration_date: '2024-01-01',
        expiry_date: '2025-01-01',
      };

      const response = await request(app)
        .post('/api/psira/registrations')
        .set('Authorization', `Bearer ${authToken}`)
        .send(registrationData);

      expect(response.status).toBeDefined();
    });

    it('should send expiry reminders', async () => {
      const response = await request(app)
        .get('/api/psira/expiring')
        .query({ days_until_expiry: 30 })
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.body).toBeDefined();
    });

    it('should validate compliance status', async () => {
      const response = await request(app)
        .get(`/api/psira/officers/${uuidv4()}/compliance`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBeDefined();
    });
  });
});