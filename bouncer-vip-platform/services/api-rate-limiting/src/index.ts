// ===========================================
// API Rate Limiting Service
// Redis-based rate limiting middleware
// ===========================================

import express, { Request, Response, NextFunction } from 'express';
import Redis from 'ioredis';

const app = express();
const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

app.use(express.json());

// ===========================================
// Rate Limiter Configuration
// ===========================================

interface RateLimitConfig {
  windowMs: number;  // Time window in milliseconds
  maxRequests: number; // Max requests per window
  keyPrefix: string;
}

const PRESETS: Record<string, RateLimitConfig> = {
  default: { windowMs: 60000, maxRequests: 100, keyPrefix: 'rate:default' },
  auth: { windowMs: 900000, maxRequests: 5, keyPrefix: 'rate:auth' }, // 5 attempts per 15 min
  api: { windowMs: 60000, maxRequests: 1000, keyPrefix: 'rate:api' },
  upload: { windowMs: 3600000, maxRequests: 50, keyPrefix: 'rate:upload' },
  webhook: { windowMs: 60000, maxRequests: 200, keyPrefix: 'rate:webhook' },
  search: { windowMs: 60000, maxRequests: 60, keyPrefix: 'rate:search' },
};

// ===========================================
// Rate Limiter Class
// ===========================================

class RateLimiter {
  private config: RateLimitConfig;

  constructor(config: RateLimitConfig) {
    this.config = config;
  }

  async isAllowed(key: string): Promise<{ allowed: boolean; remaining: number; resetAt: number }> {
    const redisKey = `${this.config.keyPrefix}:${key}`;
    const now = Date.now();
    const windowStart = now - this.config.windowMs;

    // Get current count
    const current = await redis.get(redisKey);
    
    if (!current) {
      // First request in window
      await redis.setex(redisKey, Math.ceil(this.config.windowMs / 1000), '1');
      return {
        allowed: true,
        remaining: this.config.maxRequests - 1,
        resetAt: now + this.config.windowMs,
      };
    }

    const count = parseInt(current);
    
    if (count >= this.config.maxRequests) {
      // Get TTL for key
      const ttl = await redis.ttl(redisKey);
      return {
        allowed: false,
        remaining: 0,
        resetAt: now + (ttl > 0 ? ttl * 1000 : this.config.windowMs),
      };
    }

    // Increment count
    await redis.incr(redisKey);
    
    return {
      allowed: true,
      remaining: this.config.maxRequests - count - 1,
      resetAt: now + this.config.windowMs,
    };
  }

  async reset(key: string): Promise<void> {
    const redisKey = `${this.config.keyPrefix}:${key}`;
    await redis.del(redisKey);
  }
}

// ===========================================
// Middleware Factory
// ===========================================

export function rateLimit(preset: string = 'default') {
  const config = PRESETS[preset] || PRESETS.default;
  const limiter = new RateLimiter(config);

  return async (req: Request, res: Response, next: NextFunction) => {
    // Get identifier (user ID or IP)
    const identifier = req.headers['x-user-id'] as string || 
                      req.ip || 
                      req.headers['x-forwarded-for'] as string || 
                      'unknown';

    const result = await limiter.isAllowed(identifier);

    // Set rate limit headers
    res.setHeader('X-RateLimit-Limit', config.maxRequests);
    res.setHeader('X-RateLimit-Remaining', result.remaining);
    res.setHeader('X-RateLimit-Reset', new Date(result.resetAt).toISOString());

    if (!result.allowed) {
      return res.status(429).json({
        success: false,
        error: 'Rate limit exceeded',
        retryAfter: Math.ceil((result.resetAt - Date.now()) / 1000),
      });
    }

    next();
  };
}

// ===========================================
// Custom Rate Limiter
// ===========================================

export function customRateLimit(config: Partial<RateLimitConfig>) {
  const fullConfig = { ...PRESETS.default, ...config };
  const limiter = new RateLimiter(fullConfig);

  return async (req: Request, res: Response, next: NextFunction) => {
    const identifier = req.headers['x-user-id'] as string || req.ip || 'unknown';
    const result = await limiter.isAllowed(identifier);

    res.setHeader('X-RateLimit-Limit', fullConfig.maxRequests);
    res.setHeader('X-RateLimit-Remaining', result.remaining);
    res.setHeader('X-RateLimit-Reset', new Date(result.resetAt).toISOString());

    if (!result.allowed) {
      return res.status(429).json({
        success: false,
        error: 'Rate limit exceeded',
        retryAfter: Math.ceil((result.resetAt - Date.now()) / 1000),
      });
    }

    next();
  };
}

// ===========================================
// Per-User Limits
// ===========================================

export function perUserRateLimit(maxRequests: number, windowMs: number = 60000) {
  const config: RateLimitConfig = {
    windowMs,
    maxRequests,
    keyPrefix: 'rate:user',
  };
  
  const limiter = new RateLimiter(config);

  return async (req: Request, res: Response, next: NextFunction) => {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) {
      return res.status(401).json({ error: 'User ID required' });
    }

    const result = await limiter.isAllowed(userId);

    res.setHeader('X-RateLimit-Limit', maxRequests);
    res.setHeader('X-RateLimit-Remaining', result.remaining);

    if (!result.allowed) {
      return res.status(429).json({
        success: false,
        error: 'Rate limit exceeded',
      });
    }

    next();
  };
}

// ===========================================
// Endpoint-Specific Limits
// ===========================================

export const limits = {
  // Authentication endpoints
  login: rateLimit('auth'),
  register: rateLimit('auth'),
  forgotPassword: rateLimit('auth'),
  
  // API endpoints
  api: rateLimit('api'),
  
  // File uploads
  upload: rateLimit('upload'),
  
  // Webhooks
  webhook: rateLimit('webhook'),
  
  // Search
  search: rateLimit('search'),
};

// ===========================================
// Admin Controls
// ===========================================

app.post('/api/rate-limit/reset', async (req: Request, res: Response) => {
  try {
    const { identifier, preset } = req.body;
    
    if (identifier) {
      const config = PRESETS[preset] || PRESETS.default;
      const limiter = new RateLimiter(config);
      await limiter.reset(identifier);
    } else {
      // Reset all
      const keys = await redis.keys('rate:*');
      if (keys.length > 0) {
        await redis.del(...keys);
      }
    }
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to reset rate limit' });
  }
});

app.get('/api/rate-limit/status', async (req: Request, res: Response) => {
  try {
    const identifier = req.query.identifier as string;
    const preset = req.query.preset as string || 'default';
    const config = PRESETS[preset] || PRESETS.default;
    const limiter = new RateLimiter(config);
    
    const result = await limiter.isAllowed(identifier);
    
    res.json({
      success: true,
      data: {
        allowed: result.allowed,
        remaining: result.remaining,
        resetAt: new Date(result.resetAt).toISOString(),
        limit: config.maxRequests,
        window: config.windowMs,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to get status' });
  }
});

app.get('/api/rate-limit/config', async (req: Request, res: Response) => {
  res.json({
    success: true,
    data: PRESETS,
  });
});

// ===========================================
// Health Check
// ===========================================

app.get('/health', async (req: Request, res: Response) => {
  try {
    await redis.ping();
    res.json({ status: 'healthy', service: 'api-rate-limiting' });
  } catch (error) {
    res.status(503).json({ status: 'unhealthy', service: 'api-rate-limiting' });
  }
});

const PORT = process.env.PORT || 3044;

app.listen(PORT, () => console.log(`API Rate Limiting Service on port ${PORT}`));

export default app;