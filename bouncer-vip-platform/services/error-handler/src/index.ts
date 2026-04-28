// ===========================================
// Advanced Error Handler Service
// Phase 1.2 - Standardized error handling
// ===========================================

import express, { Request, Response, NextFunction } from 'express';
import { Pool } from 'pg';

const app = express();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
app.use(express.json());

// ===========================================
// Error Codes
// ===========================================

export enum ErrorCode {
  // General
  UNKNOWN_ERROR = 'E000',
  VALIDATION_ERROR = 'E001',
  NOT_FOUND = 'E002',
  UNAUTHORIZED = 'E003',
  FORBIDDEN = 'E004',
  
  // User
  USER_NOT_FOUND = 'U001',
  EMAIL_EXISTS = 'U002',
  INVALID_CREDENTIALS = 'U003',
  WEAK_PASSWORD = 'U004',
  
  // Officer
  OFFICER_NOT_FOUND = 'O001',
  INVALID_GRADE = 'O002',
  PSIRA_EXPIRED = 'O003',
  
  // Venue
  VENUE_NOT_FOUND = 'V001',
  INVALID_RISK_LEVEL = 'V002',
  
  // Booking
  BOOKING_NOT_FOUND = 'B001',
  BOOKING_CANCELLED = 'B002',
  OFFICER_UNAVAILABLE = 'B003',
  VENUE_UNAVAILABLE = 'B004',
  
  // Payment
  PAYMENT_FAILED = 'P001',
  INVALID_AMOUNT = 'P002',
  PAYMENT_EXPIRED = 'P003',
  
  // Rate Limiting
  RATE_LIMIT_EXCEEDED = 'R001',
  
  // Database
  DB_ERROR = 'D001',
  DB_CONNECTION_ERROR = 'D002',
}

// ===========================================
// Error Response
// ===========================================

export interface ApiError {
  success: boolean;
  error: {
    code: ErrorCode;
    message: string;
    details?: any;
    requestId?: string;
    timestamp: string;
  };
}

// ===========================================
// Custom Error Class
// ===========================================

export class ApiError extends Error {
  code: ErrorCode;
  details?: any;
  statusCode: number;
  requestId: string;

  constructor(code: ErrorCode, message: string, details?: any, statusCode: number = 400) {
    super(message);
    this.code = code;
    this.message = message;
    this.details = details;
    this.statusCode = statusCode;
    this.requestId = generateRequestId();
  }

  toJSON(): ApiError {
    return {
      success: false,
      error: {
        code: this.code,
        message: this.message,
        details: this.details,
        requestId: this.requestId,
        timestamp: new Date().toISOString(),
      },
    };
  }
}

// ===========================================
// Helper Functions
// ===========================================

function generateRequestId(): string {
  return `req_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

export function errorToApiError(err: any, fallbackMessage: string = 'An error occurred'): ApiError {
  if (err instanceof ApiError) {
    return err.toJSON();
  }

  if (err.name === 'ValidationError') {
    return {
      success: false,
      error: {
        code: ErrorCode.VALIDATION_ERROR,
        message: 'Validation failed',
        details: err.details || err.message,
        requestId: generateRequestId(),
        timestamp: new Date().toISOString(),
      },
    };
  }

  if (err.name === 'CastError' || err.message?.includes('ObjectId')) {
    return {
      success: false,
      error: {
        code: ErrorCode.NOT_FOUND,
        message: 'Resource not found',
        requestId: generateRequestId(),
        timestamp: new Date().toISOString(),
      },
    };
  }

  const isProduction = process.env.NODE_ENV === 'production';

  return {
    success: false,
    error: {
      code: ErrorCode.UNKNOWN_ERROR,
      message: fallbackMessage,
      details: isProduction ? undefined : err.message,
      requestId: generateRequestId(),
      timestamp: new Date().toISOString(),
    },
  };
}

// ===========================================
// Common Error Factories
// ===========================================

export const errors = {
  notFound: (entity: string, id?: string) => 
    new ApiError(ErrorCode.NOT_FOUND, `${entity} not found${id ? `: ${id}` : ''}`, null, 404),
  
  unauthorized: (message: string = 'Unauthorized') => 
    new ApiError(ErrorCode.UNAUTHORIZED, message, null, 401),
  
  forbidden: (message: string = 'Forbidden') => 
    new ApiError(ErrorCode.FORBIDDEN, message, null, 403),
  
  validation: (details: any) => 
    new ApiError(ErrorCode.VALIDATION_ERROR, 'Validation failed', details, 400),
  
  rateLimit: () => 
    new ApiError(ErrorCode.RATE_LIMIT_EXCEEDED, 'Too many requests', null, 429),
  
  dbError: (details: any) => 
    new ApiError(ErrorCode.DB_ERROR, 'Database error', details, 500),
  
  serverError: (details?: any) => 
    new ApiError(ErrorCode.UNKNOWN_ERROR, 'Internal server error', details, 500),
};

// ===========================================
// Error Handler Middleware
// ===========================================

export function errorHandler() {
  return (err: any, req: Request, res: Response, next: NextFunction) => {
    console.error(`[ERROR] ${err.code || 'UNKNOWN'}: ${err.message}`, err.stack);

    const apiError = errorToApiError(err, 'An error occurred');
    res.status(apiError.error.statusCode || (err instanceof ApiError ? err.statusCode : 500)).json(apiError);
  };
}

// ===========================================
// Async Handler Wrapper
// ===========================================

export function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<any>) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

// ===========================================
// Not Found Handler
// ===========================================

export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({
    success: false,
    error: {
      code: ErrorCode.NOT_FOUND,
      message: `Route ${req.method} ${req.path} not found`,
      requestId: generateRequestId(),
      timestamp: new Date().toISOString(),
    },
  });
}

// ===========================================
// API Routes - Error Log
// ===========================================

app.get('/api/errors/codes', (req: Request, res: Response) => {
  res.json({ success: true, data: Object.entries(ErrorCode).map(([key, value]) => ({ name: key, code: value })) });
});

app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'healthy', service: 'error-handler' });
});

// Apply middleware
app.use(notFoundHandler);
app.use(errorHandler());

const PORT = process.env.PORT || 3086;
app.listen(PORT, () => console.log(`Error Handler Service on port ${PORT}`));

export default app;