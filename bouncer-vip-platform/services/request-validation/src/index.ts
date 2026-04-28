// ===========================================
// Request Validation Service
// Zod schemas, validation middleware, sanitization
// ===========================================

import express, { Request, Response, NextFunction } from 'express';
import { z, ZodError, ZodSchema } from 'zod';

const app = express();

app.use(express.json());

// ===========================================
// Common Validators
// ===========================================

export const validators = {
  // UUID
  uuid: z.string().uuid(),
  
  // Email
  email: z.string().email(),
  
  // Phone (South African format)
  phone: z.string().regex(/^(\+27|27|0)[6-8][0-9]{8}$/, 'Invalid South African phone number'),
  
  // Password
  password: z.string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
    .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
    .regex(/[0-9]/, 'Password must contain at least one number'),
  
  // Date
  date: z.string().refine((val) => !isNaN(Date.parse(val)), 'Invalid date'),
  
  // DateTime
  dateTime: z.string().refine((val) => !isNaN(Date.parse(val)), 'Invalid datetime'),
  
  // Time
  time: z.string().regex(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/, 'Invalid time (HH:MM)'),
  
  // Pagination
  pagination: z.object({
    page: z.number().int().positive().default(1),
    limit: z.number().int().positive().max(100).default(20),
  }),
  
  // Sorting
  sorting: z.object({
    sortBy: z.string().optional(),
    sortOrder: z.enum(['asc', 'desc']).default('desc'),
  }),
  
  // ISO Date Range
  dateRange: z.object({
    from: z.string().refine((val) => !isNaN(Date.parse(val)), 'Invalid from date'),
    to: z.string().refine((val) => !isNaN(Date.parse(val)), 'Invalid to date'),
  }),
};

// ===========================================
// Domain Validators
// ===========================================

export const authValidators = {
  login: z.object({
    email: validators.email,
    password: z.string().min(1, 'Password is required'),
  }),
  
  register: z.object({
    email: validators.email,
    password: validators.password,
    firstName: z.string().min(1, 'First name is required').max(50),
    lastName: z.string().min(1, 'Last name is required').max(50),
    phone: validators.phone.optional(),
  }),
  
  changePassword: z.object({
    currentPassword: z.string().min(1, 'Current password is required'),
    newPassword: validators.password,
    confirmPassword: z.string(),
  }).refine((data) => data.newPassword === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  }),
  
  forgotPassword: z.object({
    email: validators.email,
  }),
  
  resetPassword: z.object({
    token: z.string().min(1, 'Token is required'),
    newPassword: validators.password,
  }),
};

export const userValidators = {
  create: z.object({
    email: validators.email,
    firstName: z.string().min(1).max(50),
    lastName: z.string().min(1).max(50),
    phone: validators.phone.optional(),
    role: z.enum(['admin', 'manager', 'officer', 'client']).default('officer'),
  }),
  
  update: z.object({
    firstName: z.string().min(1).max(50).optional(),
    lastName: z.string().min(1).max(50).optional(),
    phone: validators.phone.optional(),
    email: validators.email.optional(),
  }),
};

export const venueValidators = {
  create: z.object({
    name: z.string().min(1).max(100),
    address: z.string().min(1).max(200),
    city: z.string().min(1).max(50),
    province: z.string().min(1).max(50),
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    capacity: z.number().int().positive(),
    contactPerson: z.string().max(100).optional(),
    contactPhone: validators.phone.optional(),
    riskLevel: z.enum(['low', 'medium', 'high', 'critical']).default('medium'),
  }),
  
  update: z.object({
    name: z.string().min(1).max(100).optional(),
    address: z.string().min(1).max(200).optional(),
    city: z.string().min(1).max(50).optional(),
    province: z.string().min(1).max(50).optional(),
    capacity: z.number().int().positive().optional(),
    riskLevel: z.enum(['low', 'medium', 'high', 'critical']).optional(),
  }),
};

export const bookingValidators = {
  create: z.object({
    venueId: validators.uuid,
    serviceType: z.enum(['standard', 'emergency', 'temporary', 'event']),
    requestedDate: validators.date,
    startTime: validators.time,
    endTime: validators.time,
    officerCount: z.number().int().positive().max(50),
    specialInstructions: z.string().max(1000).optional(),
  }),
  
  update: z.object({
    status: z.enum(['pending', 'confirmed', 'assigned', 'in_progress', 'completed', 'cancelled']).optional(),
    officerCount: z.number().int().positive().max(50).optional(),
    startTime: validators.time.optional(),
    endTime: validators.time.optional(),
    specialInstructions: z.string().max(1000).optional(),
  }),
};

export const shiftValidators = {
  create: z.object({
    officerId: validators.uuid,
    venueId: validators.uuid,
    startTime: validators.dateTime,
    endTime: validators.dateTime,
    hourlyRate: z.number().positive(),
    serviceType: z.enum(['standard', 'emergency', 'event']).default('standard'),
  }),
  
  checkIn: z.object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    accuracy: z.number().positive().optional(),
  }),
  
  checkOut: z.object({
    notes: z.string().max(500).optional(),
  }),
};

export const incidentValidators = {
  create: z.object({
    venueId: validators.uuid,
    shiftId: validators.uuid.optional(),
    incidentType: z.enum(['theft', 'assault', 'trespassing', 'noise', 'drugs', 'weapon', 'other']),
    severity: z.enum(['low', 'medium', 'high', 'critical']),
    title: z.string().min(1).max(200),
    description: z.string().min(1).max(2000),
    location: z.object({
      lat: z.number().min(-90).max(90),
      lng: z.number().min(-180).max(180),
    }).optional(),
  }),
  
  update: z.object({
    status: z.enum(['open', 'investigating', 'resolved', 'closed']).optional(),
    severity: z.enum(['low', 'medium', 'high', 'critical']).optional(),
    title: z.string().min(1).max(200).optional(),
    description: z.string().min(1).max(2000).optional(),
  }),
};

export const invoiceValidators = {
  create: z.object({
    venueId: validators.uuid,
    lineItems: z.array(z.object({
      description: z.string().min(1).max(200),
      quantity: z.number().positive(),
      rate: z.number().positive(),
    })).min(1),
    dueDate: validators.date,
    notes: z.string().max(500).optional(),
  }),
  
  update: z.object({
    status: z.enum(['draft', 'sent', 'paid', 'overdue', 'cancelled']).optional(),
    dueDate: validators.date.optional(),
    notes: z.string().max(500).optional(),
  }),
};

export const paginationValidators = {
  query: z.object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(20),
    sortBy: z.string().optional(),
    sortOrder: z.enum(['asc', 'desc']).default('desc'),
  }),
};

// ===========================================
// Validation Middleware
// ===========================================

export function validate<T extends ZodSchema>(schema: T) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      schema.parse(req.body);
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const errors = error.errors.map((err) => ({
          path: err.path.join('.'),
          message: err.message,
        }));
        return res.status(400).json({
          success: false,
          error: 'Validation failed',
          details: errors,
        });
      }
      next(error);
    }
  };
}

export function validateQuery<T extends ZodSchema>(schema: T) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = schema.parse(req.query);
      req.query = result as any;
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const errors = error.errors.map((err) => ({
          path: err.path.join('.'),
          message: err.message,
        }));
        return res.status(400).json({
          success: false,
          error: 'Validation failed',
          details: errors,
        });
      }
      next(error);
    }
  };
}

export function validateParams<T extends ZodSchema>(schema: T) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = schema.parse(req.params);
      req.params = result as any;
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const errors = error.errors.map((err) => ({
          path: err.path.join('.'),
          message: err.message,
        }));
        return res.status(400).json({
          success: false,
          error: 'Validation failed',
          details: errors,
        });
      }
      next(error);
    }
  };
}

// ===========================================
// Sanitization
// ===========================================

function sanitizeString(input: string): string {
  return input
    .replace(/[<>]/g, '') // Remove angle brackets
    .replace(/javascript:/gi, '') // Remove javascript: protocol
    .replace(/on\w+=/gi, '') // Remove event handlers
    .trim();
}

export function sanitizeInput(data: any): any {
  if (typeof data === 'string') {
    return sanitizeString(data);
  }
  
  if (Array.isArray(data)) {
    return data.map(sanitizeInput);
  }
  
  if (typeof data === 'object' && data !== null) {
    const sanitized: any = {};
    for (const [key, value] of Object.entries(data)) {
      sanitized[key] = sanitizeInput(value);
    }
    return sanitized;
  }
  
  return data;
}

// ===========================================
// API Routes
// ===========================================

app.post('/api/validate', (req: Request, res: Response) => {
  res.json({ 
    success: true, 
    message: 'Validation service is running',
    schemas: Object.keys(validators).concat([
      'auth', 'user', 'venue', 'booking', 'shift', 'incident', 'invoice', 'pagination'
    ])
  });
});

app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'healthy', service: 'request-validation' });
});

const PORT = process.env.PORT || 3042;

app.listen(PORT, () => console.log(`Request Validation Service on port ${PORT}`));

export default app;