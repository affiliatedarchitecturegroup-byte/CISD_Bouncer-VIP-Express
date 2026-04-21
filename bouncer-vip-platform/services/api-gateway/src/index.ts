import dotenv from 'dotenv';
import express, { Express, Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { createClient, RedisClientType } from 'redis';
import { Registry, Counter, Histogram, Gauge } from 'prom-client';
import winston from 'winston';
import jwt from 'jsonwebtoken';
import { z } from 'zod';

dotenv.config();

const config = { port: parseInt(process.env.PORT || '3000', 10), nodeEnv: process.env.NODE_ENV || 'development', jwtSecret: process.env.JWT_SECRET || 'dev-secret',
  redis: { host: process.env.REDIS_HOST || 'localhost', port: parseInt(process.env.REDIS_PORT || '6379', 10) },
};

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'debug',
  format: winston.format.combine(winston.format.timestamp(), winston.format.errors({ stack: true }), winston.format.json()),
  defaultMeta: { service: 'api-gateway' },
  transports: [new winston.transports.Console({ format: winston.format.combine(winston.format.colorize(), winston.format.simple()) })],
});

let redisClient: RedisClientType;
async function getRedis(): Promise<RedisClientType> {
  if (!redisClient) { redisClient = createClient({ socket: { host: config.redis.host, port: config.redis.port } });
    redisClient.on('error', (err) => logger.error('Redis error:', err)); await redisClient.connect(); logger.info('Redis connected');
  }
  return redisClient;
}

export const metricsRegistry = new Registry();
const httpRequestsTotal = new Counter({ name: 'http_requests_total', help: 'Total HTTP requests', labelNames: ['method', 'path', 'status', 'service'], registers: [metricsRegistry] });
const httpRequestDuration = new Histogram({ name: 'http_request_duration_seconds', help: 'Duration', labelNames: ['method', 'path', 'status', 'service'],
  buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 5], registers: [metricsRegistry] });
const activeConnections = new Gauge({ name: 'active_connections', help: 'Active connections', registers: [metricsRegistry] });

const app: Express = express();

// Service routes
const SERVICES = {
  '/api/crm': 'http://localhost:3001',
  '/api/scheduling': 'http://localhost:3002',
  '/api/on-demand': 'http://localhost:3003',
  '/api/monitoring': 'http://localhost:3004',
  '/api/erp': 'http://localhost:3005',
  '/api/workflow': 'http://localhost:3006',
  '/api/guard': 'http://localhost:3007',
  '/api/biometrics': 'http://localhost:3008',
  '/api/penalty': 'http://localhost:3009',
  '/api/recruitment': 'http://localhost:3010',
  '/api/psira': 'http://localhost:3011',
  '/api/analytics': 'http://localhost:3012',
  '/api/notifications': 'http://localhost:3013',
};

app.use(helmet({ contentSecurityPolicy: false }));
app.use((req: Request, res: Response, next: NextFunction) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-Request-ID');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Rate limiting
const rateLimiter = async (req: Request, res: Response, next: NextFunction) => {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const key = `ratelimit:${ip}`;
  const redis = await getRedis();
  const current = await redis.incr(key);
  if (current === 1) await redis.expire(key, 60);
  if (current > 100) return res.status(429).json({ error: 'Too many requests' });
  next();
};
app.use(rateLimiter);

// Auth middleware
function authenticate(req: Request, res: Response, next: NextFunction) {
  const publicPaths = ['/health', '/metrics', '/api/crm/auth/login', '/api/guard/auth/login', '/api/crm/venues/public'];
  if (publicPaths.some((p) => req.path.startsWith(p))) return next();

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ error: 'No token provided' });
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, config.jwtSecret) as any;
    (req as any).user = decoded;
    next();
  } catch { res.status(401).json({ error: 'Invalid token' }); }
}
app.use(authenticate);

// Metrics
app.get('/metrics', async (req: Request, res: Response) => { res.set('Content-Type', metricsRegistry.contentType); res.send(await metricsRegistry.metrics()); });
app.get('/health', (req: Request, res: Response) => { res.json({ status: 'healthy', services: Object.keys(SERVICES), timestamp: new Date().toISOString() }); });

// Service proxy
Object.entries(SERVICES).forEach(([path, target]) => {
  app.use(path, createProxyMiddleware({ target, changeOrigin: true, pathRewrite: { [`^${path}`: '' } },
    onProxyReq: (proxyReq, req) => { proxyReq.setHeader('X-User-ID', (req as any).user?.officerId || 'anonymous');
      proxyReq.setHeader('X-Request-ID', req.headers['x-request-id'] || ''); },
    onProxyRes: (proxyRes, req) => {
      const duration = Date.now() - (req as any).startTime;
      httpRequestsTotal.inc({ method: req.method, path: req.path, status: proxyRes.statusCode, service: path.slice(5) });
      httpRequestDuration.observe({ method: req.method, path: req.path, status: proxyRes.statusCode, service: path.slice(5) }, duration / 1000);
    },
  }));
});

// 404
app.use((req: Request, res: Response) => { res.status(404).json({ error: 'Not found' }); });

// Error handler
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  logger.error('Gateway error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

async function startServer() {
  try {
    await getRedis();
    activeConnections.set(0);
    app.listen(config.port, () => logger.info(`API Gateway running on port ${config.port}`));
  } catch (error) { logger.error('Failed to start server:', error); process.exit(1); }
}

process.on('SIGTERM', async () => { logger.info('SIGTERM, shutting down'); if (redisClient) await redisClient.quit(); process.exit(0); });
process.on('SIGINT', async () => { logger.info('SIGINT, shutting down'); if (redisClient) await redisClient.quit(); process.exit(0); });

startServer();
export default app;