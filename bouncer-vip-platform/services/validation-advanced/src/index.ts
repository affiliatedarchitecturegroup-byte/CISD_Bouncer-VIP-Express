// ===========================================
// Advanced Validation Service
// Phase 1.1 - Enhanced validation layer
// ===========================================

import express, { Request, Response, NextFunction } from 'express';
import { Pool } from 'pg';

const app = express();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
app.use(express.json());

// ===========================================
// Validation Types
// ===========================================

type ValidationType = 'string' | 'number' | 'date' | 'email' | 'phone' | 'uuid' | 'enum';
type ValidationOperator = 'required' | 'min' | 'max' | 'pattern' | 'custom';

interface ValidationRule {
  field: string;
  type: ValidationType;
  required?: boolean;
  min?: number;
  max?: number;
  pattern?: RegExp;
  enum?: string[];
  custom?: (value: any) => boolean | Promise<boolean>;
  message?: string;
}

interface ValidationError {
  field: string;
  message: string;
  value?: any;
}

interface ValidatedData {
  [key: string]: any;
}

// ===========================================
// Validators
// ===========================================

const validators: Record<ValidationType, (value: any, rule: ValidationRule) => boolean> = {
  string: (value, rule) => {
    if (typeof value !== 'string') return false;
    if (rule.min && value.length < rule.min) return false;
    if (rule.max && value.length > rule.max) return false;
    if (rule.pattern && !rule.pattern.test(value)) return false;
    return true;
  },

  number: (value, rule) => {
    if (typeof value !== 'number') return false;
    if (rule.min !== undefined && value < rule.min) return false;
    if (rule.max !== undefined && value > rule.max) return false;
    return true;
  },

  date: (value, rule) => {
    const date = new Date(value);
    if (isNaN(date.getTime())) return false;
    return true;
  },

  email: (value, rule) => {
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailPattern.test(value);
  },

  phone: (value, rule) => {
    const phonePattern = /^\+?[1-9]\d{1,14}$/;
    return phonePattern.test(value.replace(/[\s-]/g, ''));
  },

  uuid: (value, rule) => {
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return uuidPattern.test(value);
  },

  enum: (value, rule) => {
    return rule.enum?.includes(value) || false;
  },
};

// ===========================================
// Core Validator
// ===========================================

export function validate(rules: ValidationRule[], data: ValidatedData): ValidationError[] {
  const errors: ValidationError[] = [];

  for (const rule of rules) {
    const value = data[rule.field];

    // Check required
    if (rule.required && (value === undefined || value === null || value === '')) {
      errors.push({
        field: rule.field,
        message: rule.message || `${rule.field} is required`,
        value,
      });
      continue;
    }

    // Skip other validations if empty and not required
    if (value === undefined || value === null || value === '') {
      continue;
    }

    // Run type validator
    const validator = validators[rule.type];
    if (validator && !validator(value, rule)) {
      errors.push({
        field: rule.field,
        message: rule.message || `${rule.field} is invalid`,
        value,
      });
    }

    // Run custom validator
    if (rule.custom) {
      const customValid = rule.custom(value);
      if (customValid instanceof Promise) {
        // Async validation handled separately
      } else if (!customValid) {
        errors.push({
          field: rule.field,
          message: rule.message || `${rule.field} failed validation`,
          value,
        });
      }
    }
  }

  return errors;
}

// ===========================================
// Async Validator
// ===========================================

export async function validateAsync(rules: ValidationRule[], data: ValidatedData): Promise<ValidationError[]> {
  const errors: ValidationError[] = [];

  for (const rule of rules) {
    const value = data[rule.field];

    if (rule.required && (value === undefined || value === null || value === '')) {
      errors.push({ field: rule.field, message: `${rule.field} is required`, value });
      continue;
    }

    if (value === undefined || value === null || value === '') continue;

    if (rule.custom) {
      const valid = await rule.custom(value);
      if (!valid) {
        errors.push({ field: rule.field, message: rule.message || `${rule.field} failed validation`, value });
      }
    }
  }

  return errors;
}

// ===========================================
// Cross-Field Validation
// ===========================================

interface CrossFieldRule {
  fields: string[];
  validate: (values: ValidatedData) => boolean;
  message: string;
}

export function validateCrossField(rules: CrossFieldRule[], data: ValidatedData): ValidationError[] {
  const errors: ValidationError[] = [];

  for (const rule of rules) {
    if (!rule.validate(data)) {
      errors.push({
        field: rule.fields.join('_'),
        message: rule.message,
      });
    }
  }

  return errors;
}

// ===========================================
// Predefined Rule Sets
// ===========================================

export const userValidationRules: ValidationRule[] = [
  { field: 'email', type: 'email', required: true, message: 'Valid email is required' },
  { field: 'password', type: 'string', required: true, min: 8, max: 128, message: 'Password must be 8-128 characters' },
  { field: 'first_name', type: 'string', required: true, min: 1, max: 50 },
  { field: 'last_name', type: 'string', required: true, min: 1, max: 50 },
  { field: 'phone', type: 'phone', required: false },
];

export const officerValidationRules: ValidationRule[] = [
  { field: 'email', type: 'email', required: true },
  { field: 'first_name', type: 'string', required: true, min: 1, max: 50 },
  { field: 'last_name', type: 'string', required: true, min: 1, max: 50 },
  { field: 'phone', type: 'phone', required: true },
  { field: 'grade', type: 'enum', required: true, enum: ['A', 'B', 'C', 'D', 'E'] },
  { field: 'psira_number', type: 'string', required: true, min: 5, max: 20 },
];

export const venueValidationRules: ValidationRule[] = [
  { field: 'name', type: 'string', required: true, min: 2, max: 100 },
  { field: 'address', type: 'string', required: true, min: 5 },
  { field: 'city', type: 'string', required: true },
  { field: 'province', type: 'string', required: true },
  { field: 'latitude', type: 'number', required: true, min: -90, max: 90 },
  { field: 'longitude', type: 'number', required: true, min: -180, max: 180 },
  { field: 'capacity', type: 'number', required: true, min: 1, max: 100000 },
  { field: 'risk_level', type: 'enum', required: true, enum: ['low', 'medium', 'high', 'critical'] },
];

export const bookingValidationRules: ValidationRule[] = [
  { field: 'venue_id', type: 'uuid', required: true },
  { field: 'client_id', type: 'uuid', required: true },
  { field: 'service_type', type: 'enum', required: true, enum: ['standard', 'emergency', 'temporary', 'event'] },
  { field: 'requested_date', type: 'date', required: true },
  { field: 'start_time', type: 'string', required: true, pattern: /^([01]\d|2[0-3]):([0-5]\d)$/ },
  { field: 'end_time', type: 'string', required: true, pattern: /^([01]\d|2[0-3]):([0-5]\d)$/ },
  { field: 'officer_count', type: 'number', required: true, min: 1, max: 100 },
];

export const invoiceValidationRules: ValidationRule[] = [
  { field: 'client_id', type: 'uuid', required: true },
  { field: 'venue_id', type: 'uuid', required: true },
  { field: 'due_date', type: 'date', required: true },
  { field: 'line_items', type: 'array', required: true, min: 1 },
];

// ===========================================
// Middleware Factory
// ===========================================

export function validateRequest(rules: ValidationRule[], crossFieldRules?: CrossFieldRule[]) {
  return async (req: Request, res: Response, next: NextFunction) => {
    // Validate main fields
    let errors = validate(rules, req.body);

    // Validate cross-field rules
    if (crossFieldRules?.length) {
      const crossErrors = validateCrossField(crossFieldRules, req.body);
      errors = [...errors, ...crossErrors];
    }

    // Return errors if any
    if (errors.length > 0) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors,
      });
    }

    next();
  };
}

// ===========================================
// API Routes
// ===========================================

app.post('/api/validate', async (req: Request, res: Response) => {
  const { rules, data } = req.body;
  const errors = validate(rules, data);
  res.json({ success: errors.length === 0, errors });
});

app.post('/api/validate/user', async (req: Request, res: Response) => {
  const errors = validate(userValidationRules, req.body);
  res.json({ success: errors.length === 0, errors });
});

app.post('/api/validate/officer', async (req: Request, res: Response) => {
  const errors = validate(officerValidationRules, req.body);
  res.json({ success: errors.length === 0, errors });
});

app.post('/api/validate/venue', async (req: Request, res: Response) => {
  const errors = validate(venueValidationRules, req.body);
  res.json({ success: errors.length === 0, errors });
});

app.post('/api/validate/booking', async (req: Request, res: Response) => {
  const errors = validate(bookingValidationRules, req.body);
  res.json({ success: errors.length === 0, errors });
});

app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'healthy', service: 'validation-advanced' });
});

const PORT = process.env.PORT || 3085;
app.listen(PORT, () => console.log(`Advanced Validation Service on port ${PORT}`));

export default app;