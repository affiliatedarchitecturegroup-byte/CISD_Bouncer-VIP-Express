import dotenv from 'dotenv';
import express, { Express, Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import { createClient } from 'redis';
import knex from 'knex';
import { Registry, Counter, Histogram } from 'prom-client';
import { connect, JetStreamClient, StringCodec } from 'nats';
import winston from 'winston';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';

dotenv.config();

// ============================================
// CONFIGURATION
// ============================================

const config = {
  port: parseInt(process.env.PORT || '3001', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  logLevel: process.env.LOG_LEVEL || 'debug',
  postgres: {
    host: process.env.POSTGRES_HOST || 'localhost',
    port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
    database: process.env.POSTGRES_DB || 'bouncer_express',
    user: process.env.POSTGRES_USER || 'bouncer',
    password: process.env.POSTGRES_PASSWORD || 'dev_password',
  },
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
  },
  nats: {
    url: `nats://${process.env.NATS_HOST || 'localhost'}:${process.env.NATS_PORT || '4222'}`,
  },
};

// ============================================
// LOGGING
// ============================================

const logger = winston.createLogger({
  level: config.logLevel,
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'crm-service' },
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(winston.format.colorize(), winston.format.simple()),
    }),
  ],
});

if (config.nodeEnv === 'production') {
  logger.add(new winston.transports.File({ filename: 'logs/error.log', level: 'error' }));
  logger.add(new winston.transports.File({ filename: 'logs/combined.log' }));
}

// ============================================
// DATABASE
// ============================================

const db = knex({
  client: 'pg',
  connection: config.postgres,
  pool: { min: 2, max: 10 },
  migrations: {
    directory: './migrations',
  },
});

// ============================================
// REDIS CACHE
// ============================================

let redisClient: ReturnType<typeof createClient>;

async function getRedis() {
  if (!redisClient) {
    redisClient = createClient({
      socket: {
        host: config.redis.host,
        port: config.redis.port,
      },
    });
    redisClient.on('error', (err) => logger.error('Redis error:', err));
    await redisClient.connect();
    logger.info('Redis connected');
  }
  return redisClient;
}

// ============================================
// NATS JETSTREAM
// ============================================

let nc: JetStreamClient;
let stringCodec: StringCodec;

async function getNATS() {
  if (!nc) {
    nc = await connect({ servers: config.nats.url });
    stringCodec = new StringCodec();
    logger.info('NATS connected');
  }
  return nc;
}

// ============================================
// PROMETHEUS METRICS
// ============================================

export const metricsRegistry = new Registry();

const httpRequestsTotal = new Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'path', 'status'],
  registers: [metricsRegistry],
});

const httpRequestDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'path', 'status'],
  buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 5],
  registers: [metricsRegistry],
});

// ============================================
// EXPRESS APP
// ============================================

const app: Express = express();

// Security middleware
app.use(helmet());

// CORS - configure in production
app.use((req: Request, res: Response, next: NextFunction) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Logging
app.use(morgan('combined'));

// Body parsing
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Metrics endpoint
app.get('/metrics', async (req: Request, res: Response) => {
  res.set('Content-Type', metricsRegistry.contentType);
  res.send(await metricsRegistry.metrics());
});

// Health check
app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// ============================================
// VALIDATION SCHEMAS (Zod)
// ============================================

const VenueSchema = z.object({
  name: z.string().min(1).max(255),
  address: z.string().min(1),
  contact_person: z.string().min(1),
  contact_email: z.string().email(),
  contact_phone: z.string().min(10),
  venue_type: z.enum(['bar', 'club', 'restaurant', 'hotel', 'event_venue', 'other']),
  psira_license: z.string().optional(),
  status: z.enum(['active', 'inactive', 'pending']).default('pending'),
  subscription_tier: z.enum(['basic', 'standard', 'premium']).default('basic'),
});

const ClientSchema = z.object({
  venue_id: z.string().uuid(),
  first_name: z.string().min(1).max(100),
  last_name: z.string().min(1).max(100),
  email: z.string().email(),
  phone: z.string().min(10),
  role: z.enum(['owner', 'manager', 'contact']).default('contact'),
});

// ============================================
// API ROUTES
// ============================================

// Get all venues
app.get('/api/crm/venues', async (req: Request, res: Response) => {
  try {
    const cacheKey = 'crm:venues:all';
    const redis = await getRedis();
    
    // Try cache first
    const cached = await redis.get(cacheKey);
    if (cached) {
      logger.debug('Cache hit for venues');
      return res.json(JSON.parse(cached));
    }
    
    const venues = await db('venues').select('*').orderBy('created_at', 'desc');
    
    // Cache for 5 minutes
    await redis.setEx(cacheKey, 300, JSON.stringify(venues));
    
    httpRequestsTotal.inc({ method: 'GET', path: '/api/crm/venues', status: '200' });
    res.json(venues);
  } catch (error) {
    logger.error('Error fetching venues:', error);
    httpRequestsTotal.inc({ method: 'GET', path: '/api/crm/venues', status: '500' });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get venue by ID
app.get('/api/crm/venues/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const venue = await db('venues').where({ id }).first();
    
    if (!venue) {
      httpRequestsTotal.inc({ method: 'GET', path: '/api/crm/venues/:id', status: '404' });
      return res.status(404).json({ error: 'Venue not found' });
    }
    
    httpRequestsTotal.inc({ method: 'GET', path: '/api/crm/venues/:id', status: '200' });
    res.json(venue);
  } catch (error) {
    logger.error('Error fetching venue:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create venue
app.post('/api/crm/venues', async (req: Request, res: Response) => {
  const startTime = Date.now();
  
  try {
    const validatedData = VenueSchema.parse(req.body);
    const id = uuidv4();
    
    const [venue] = await db('venues')
      .insert({ ...validatedData, id, created_at: new Date(), updated_at: new Date() })
      .returning('*');
    
    // Emit domain event to NATS
    const nats = await getNATS();
    await nats.jetstream().publish(
      'crm.venues.created',
      stringCodec.encode(JSON.stringify({ type: 'VENUE_CREATED', payload: venue })),
      { msgID: uuidv4() }
    );
    
    // Invalidate cache
    const redis = await getRedis();
    await redis.del('crm:venues:all');
    
    httpRequestsTotal.inc({ method: 'POST', path: '/api/crm/venues', status: '201' });
    httpRequestDuration.observe({ method: 'POST', path: '/api/crm/venues', status: '201' }, (Date.now() - startTime) / 1000);
    
    res.status(201).json(venue);
  } catch (error) {
    if (error instanceof z.ZodError) {
      httpRequestsTotal.inc({ method: 'POST', path: '/api/crm/venues', status: '400' });
      return res.status(400).json({ error: 'Validation error', details: error.errors });
    }
    
    logger.error('Error creating venue:', error);
    httpRequestsTotal.inc({ method: 'POST', path: '/api/crm/venues', status: '500' });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update venue
app.put('/api/crm/venues/:id', async (req: Request, res: Response) => {
  const startTime = Date.now();
  
  try {
    const { id } = req.params;
    const validatedData = VenueSchema.partial().parse(req.body);
    
    const [venue] = await db('venues')
      .where({ id })
      .update({ ...validatedData, updated_at: new Date() })
      .returning('*');
    
    if (!venue) {
      httpRequestsTotal.inc({ method: 'PUT', path: '/api/crm/venues/:id', status: '404' });
      return res.status(404).json({ error: 'Venue not found' });
    }
    
    // Emit domain event
    const nats = await getNATS();
    await nats.jetstream().publish(
      'crm.venues.updated',
      stringCodec.encode(JSON.stringify({ type: 'VENUE_UPDATED', payload: venue })),
      { msgID: uuidv4() }
    );
    
    // Invalidate cache
    const redis = await getRedis();
    await redis.del('crm:venues:all');
    
    httpRequestsTotal.inc({ method: 'PUT', path: '/api/crm/venues/:id', status: '200' });
    httpRequestDuration.observe({ method: 'PUT', path: '/api/crm/venues/:id', status: '200' }, (Date.now() - startTime) / 1000);
    
    res.json(venue);
  } catch (error) {
    if (error instanceof z.ZodError) {
      httpRequestsTotal.inc({ method: 'PUT', path: '/api/crm/venues/:id', status: '400' });
      return res.status(400).json({ error: 'Validation error', details: error.errors });
    }
    
    logger.error('Error updating venue:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete venue
app.delete('/api/crm/venues/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    
    const deleted = await db('venues').where({ id }).delete();
    
    if (!deleted) {
      httpRequestsTotal.inc({ method: 'DELETE', path: '/api/crm/venues/:id', status: '404' });
      return res.status(404).json({ error: 'Venue not found' });
    }
    
    // Emit domain event
    const nats = await getNATS();
    await nats.jetstream().publish(
      'crm.venues.deleted',
      stringCodec.encode(JSON.stringify({ type: 'VENUE_DELETED', payload: { id } })),
      { msgID: uuidv4() }
    );
    
    // Invalidate cache
    const redis = await getRedis();
    await redis.del('crm:venues:all');
    
    httpRequestsTotal.inc({ method: 'DELETE', path: '/api/crm/venues/:id', status: '204' });
    res.sendStatus(204);
  } catch (error) {
    logger.error('Error deleting venue:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================
// ERROR HANDLING
// ============================================

app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  logger.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// ============================================
// START SERVER
// ============================================

async function startServer() {
  try {
    // Initialize connections
    await getRedis();
    await getNATS();
    
    // Verify database connection
    await db.raw('SELECT 1');
    logger.info('PostgreSQL connected');
    
    // Start HTTP server
    app.listen(config.port, () => {
      logger.info(`CRM Service running on port ${config.port}`);
      logger.info(`Environment: ${config.nodeEnv}`);
    });
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down gracefully');
  await db.destroy();
  if (redisClient) await redisClient.quit();
  if (nc) await nc.close();
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received, shutting down gracefully');
  await db.destroy();
  if (redisClient) await redisClient.quit();
  if (nc) await nc.close();
  process.exit(0);
});

startServer();

export default app;