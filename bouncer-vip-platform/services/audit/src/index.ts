import dotenv from 'dotenv';
import express, { Express, Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import { createClient, RedisClientType } from 'redis';
import knex, { Knex } from 'knex';
import { Registry, Counter, Histogram, Gauge } from 'prom-client';
import { connect, JetStreamClient, StringCodec, JSONCodec } from 'nats';
import winston from 'winston';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import crypto from 'crypto';

dotenv.config();

const config = {
  port: parseInt(process.env.PORT || '3014', 10), nodeEnv: process.env.NODE_ENV || 'development',
  postgres: { host: process.env.POSTGRES_HOST || 'localhost', port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
    database: process.env.POSTGRES_DB || 'bouncer_express', user: process.env.POSTGRES_USER || 'bouncer', password: process.env.POSTGRES_PASSWORD || 'dev_password' },
  redis: { host: process.env.REDIS_HOST || 'localhost', port: parseInt(process.env.REDIS_PORT || '6379', 10) },
  nats: { url: `nats://${process.env.NATS_HOST || 'localhost'}:${process.env.NATS_PORT || '4222'}` },
  retentionDays: 90,
};

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'debug',
  format: winston.format.combine(winston.format.timestamp(), winston.format.errors({ stack: true }), winston.format.json()),
  defaultMeta: { service: 'audit-service' },
  transports: [new winston.transports.Console({ format: winston.format.combine(winston.format.colorize(), winston.format.simple()) })],
});

const db: Knex = knex({ client: 'pg', connection: config.postgres, pool: { min: 2, max: 10 } });

let redisClient: RedisClientType;
async function getRedis(): Promise<RedisClientType> {
  if (!redisClient) { redisClient = createClient({ socket: { host: config.redis.host, port: config.redis.port } });
    redisClient.on('error', (err) => logger.error('Redis error:', err)); await redisClient.connect(); logger.info('Redis connected');
  }
  return redisClient;
}

let nc: JetStreamClient;
let stringCodec: StringCodec;
let jsonCodec: JSONCodec<any>;
async function getNATS(): Promise<JetStreamClient> {
  if (!nc) { nc = await connect({ servers: config.nats.url }); stringCodec = new StringCodec(); jsonCodec = JSONCodec(); logger.info('NATS connected'); }
  return nc;
}

export const metricsRegistry = new Registry();
const httpRequestsTotal = new Counter({ name: 'http_requests_total', help: 'Total HTTP requests', labelNames: ['method', 'path', 'status'], registers: [metricsRegistry] });
const auditEventsLogged = new Counter({ name: 'audit_events_logged_total', help: 'Audit events logged', registers: [metricsRegistry] });
const eventsBufferedGauge = new Gauge({ name: 'audit_events_buffered', help: 'Events in buffer', registers: [metricsRegistry] });

const app: Express = express();
app.use(helmet());
app.use((req: Request, res: Response, next: NextFunction) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});
app.use(morgan('combined'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get('/metrics', async (req: Request, res: Response) => { res.set('Content-Type', metricsRegistry.contentType); res.send(await metricsRegistry.metrics()); });
app.get('/health', (req: Request, res: Response) => { res.json({ status: 'healthy', timestamp: new Date().toISOString() }); });

// Hash for PII
function hashData(data: string): string {
  return crypto.createHash('sha256').update(data).digest('hex').slice(0, 16);
}

// Log audit event
async function logAuditEvent(event: { action: string; resource: string; userId?: string; ip?: string; details?: any; metadata?: any }) {
  const id = uuidv4();
  const timestamp = new Date();
  
  // Store in database
  await db('audit_logs').insert({
    id, action: event.action, resource: event.resource,
    user_id: event.userId ? hashData(event.userId) : null,
    ip_address: event.ip ? hashData(event.ip) : null,
    details: event.details ? JSON.stringify(event.details) : null,
    metadata: event.metadata ? JSON.stringify(event.metadata) : null,
    timestamp, created_at: timestamp,
  });

  // Also publish to NATS for real-time consumers
  const nats = await getNATS();
  await nats.jetstream().publish('audit.events',
    stringCodec.encode(JSON.stringify({ id, ...event, timestamp: timestamp.toISOString() })), { msgID: id });

  auditEventsLogged.inc();
  return id;
}

// Middleware to auto-log API requests
function auditMiddleware(req: Request, res: Response, next: NextFunction) {
  const startTime = Date.now();
  const userId = (req as any).user?.officerId || (req as any).user?.id;
  
  res.on('finish', () => {
    const event = {
      action: `${req.method} ${req.path}`,
      resource: req.path.split('/')[2] || 'unknown',
      userId,
      ip: req.ip,
      details: { status: res.statusCode, duration: Date.now() - startTime },
      metadata: { method: req.method, path: req.path, query: req.query },
    };
    if (res.statusCode >= 400) logger.warn('Audit:', event);
    else logAuditEvent(event).catch((e) => logger.error('Audit log error:', e));
  });
  next();
}

// API ROUTES
app.post('/api/audit/log', async (req: Request, res: Response) => {
  try {
    const { action, resource, details, metadata } = req.body;
    if (!action || !resource) return res.status(400).json({ error: 'action and resource required' });
    
    const id = await logAuditEvent({ action, resource, details, metadata });
    httpRequestsTotal.inc({ method: 'POST', path: '/api/audit/log', status: '201' });
    res.status(201).json({ id, success: true });
  } catch (error) { logger.error('Log error:', error); res.status(500).json({ error: 'Internal server error' }); }
});

app.get('/api/audit/logs', async (req: Request, res: Response) => {
  try {
    const { action, resource, user_id, date_from, date_to, limit } = req.query;
    let query = db('audit_logs').orderBy('timestamp', 'desc').limit(parseInt(limit as string) || 100);
    
    if (action) query = query.where('action', 'like', `%${action}%`);
    if (resource) query = query.where('resource', resource as string);
    if (user_id) query = query.where('user_id', hashData(user_id as string));
    if (date_from || date_to) {
      query = query.where(function () {
        if (date_from) this.where('timestamp', '>=', date_from);
        if (date_to) this.where('timestamp', '<=', date_to);
      });
    }
    
    const logs = await query;
    httpRequestsTotal.inc({ method: 'GET', path: '/api/audit/logs', status: '200' });
    res.json(logs);
  } catch (error) { logger.error('Fetch error:', error); res.status(500).json({ error: 'Internal server error' }); }
});

app.get('/api/audit/logs/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const log = await db('audit_logs').where('id', id).first();
    if (!log) return res.status(404).json({ error: 'Log not found' });
    httpRequestsTotal.inc({ method: 'GET', path: '/api/audit/logs/:id', status: '200' });
    res.json(log);
  } catch (error) { logger.error('Fetch error:', error); res.status(500).json({ error: 'Internal server error' }); }
});

app.get('/api/audit/stats', async (req: Request, res: Response) => {
  try {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const thisWeek = new Date(); thisWeek.setDate(thisWeek.getDate() - 7);
    const thisMonth = new Date(); thisMonth.setMonth(thisMonth.getMonth() - 1);

    const [todayLogs, weekLogs, monthLogs, byAction, byResource] = await Promise.all([
      db('audit_logs').where('timestamp', '>=', today).count('id as count').first(),
      db('audit_logs').where('timestamp', '>=', thisWeek).count('id as count').first(),
      db('audit_logs').where('timestamp', '>=', thisMonth).count('id as count').first(),
      db('audit_logs').select('action').count('id as count').groupBy('action').orderBy('count', 'desc').limit(10),
      db('audit_logs').select('resource').count('id as count').groupBy('resource').orderBy('count', 'desc').limit(10),
    ]);

    httpRequestsTotal.inc({ method: 'GET', path: '/api/audit/stats', status: '200' });
    res.json({
      today: parseInt(todayLogs?.count as string) || 0,
      this_week: parseInt(weekLogs?.count as string) || 0,
      this_month: parseInt(monthLogs?.count as string) || 0,
      by_action: byAction, by_resource: byResource,
    });
  } catch (error) { logger.error('Stats error:', error); res.status(500).json({ error: 'Internal server error' }); }
});

// Retention cleanup
async function cleanupOldLogs() {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - config.retentionDays);
  const deleted = await db('audit_logs').where('timestamp', '<', cutoff).delete();
  if (deleted > 0) logger.info(`Cleaned up ${deleted} old audit logs`);
}

// Run cleanup daily
setInterval(cleanupOldLogs, 24 * 60 * 60 * 1000);

app.use((err: Error, req: Request, res: Response, next: NextFunction) => { logger.error('Unhandled error:', err); res.status(500).json({ error: 'Internal server error' }); });

async function startServer() {
  try {
    await getRedis();
    await getNATS();
    await db.raw('SELECT 1');
    logger.info('PostgreSQL connected');
    cleanupOldLogs();
    app.listen(config.port, () => logger.info(`Audit Service running on port ${config.port}`));
  } catch (error) { logger.error('Failed to start server:', error); process.exit(1); }
}

process.on('SIGTERM', async () => { logger.info('SIGTERM, shutting down'); await db.destroy(); if (redisClient) await redisClient.quit(); if (nc) await nc.close(); process.exit(0); });
process.on('SIGINT', async () => { logger.info('SIGINT, shutting down'); await db.destroy(); if (redisClient) await redisClient.quit(); if (nc) await nc.close(); process.exit(0); });

startServer();
export default app;