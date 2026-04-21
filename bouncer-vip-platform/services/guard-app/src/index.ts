import dotenv from 'dotenv';
import express, { Express, Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import { createClient, RedisClientType } from 'redis';
import knex, { Knex } from 'knex';
import { Registry, Counter, Histogram, Gauge } from 'prom-client';
import { connect, JetStreamClient, StringCodec } from 'nats';
import winston from 'winston';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';

dotenv.config();

interface Config { port: number; nodeEnv: string; jwtSecret: string; postgres: { host: string; port: number; database: string; user: string; password: string }; redis: { host: string; port: number }; nats: { url: string }; }

const config: Config = {
  port: parseInt(process.env.PORT || '3007', 10), nodeEnv: process.env.NODE_ENV || 'development', jwtSecret: process.env.JWT_SECRET || 'dev-secret',
  postgres: { host: process.env.POSTGRES_HOST || 'localhost', port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
    database: process.env.POSTGRES_DB || 'bouncer_express', user: process.env.POSTGRES_USER || 'bouncer', password: process.env.POSTGRES_PASSWORD || 'dev_password' },
  redis: { host: process.env.REDIS_HOST || 'localhost', port: parseInt(process.env.REDIS_PORT || '6379', 10) },
  nats: { url: `nats://${process.env.NATS_HOST || 'localhost'}:${process.env.NATS_PORT || '4222'}` },
};

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'debug',
  format: winston.format.combine(winston.format.timestamp(), winston.format.errors({ stack: true }), winston.format.json()),
  defaultMeta: { service: 'guard-app-service' },
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
async function getNATS(): Promise<JetStreamClient> {
  if (!nc) { nc = await connect({ servers: config.nats.url }); stringCodec = new StringCodec(); logger.info('NATS connected'); }
  return nc;
}

export const metricsRegistry = new Registry();
const httpRequestsTotal = new Counter({ name: 'http_requests_total', help: 'Total HTTP requests', labelNames: ['method', 'path', 'status'], registers: [metricsRegistry] });
const httpRequestDuration = new Histogram({ name: 'http_request_duration_seconds', help: 'Duration', labelNames: ['method', 'path', 'status'],
  buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 5], registers: [metricsRegistry] });
const activeGuardsGauge = new Gauge({ name: 'active_guards', help: 'Active guards', registers: [metricsRegistry] });

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

// MIDDLEWARE
function authenticate(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ error: 'No token provided' });
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, config.jwtSecret) as { officerId: string };
    (req as any).officerId = decoded.officerId;
    next();
  } catch { res.status(401).json({ error: 'Invalid token' }); }
}

// VALIDATION
const LoginSchema = z.object({ email: z.string().email(), password: z.string().min(6) });
const ClockInSchema = z.object({ latitude: z.number(), longitude: z.number(), photo_data: z.string().optional() });
const IncidentReportSchema = z.object({ incident_type: z.enum(['theft', 'assault', 'breach', 'medical', 'fire', 'noise', 'trespasser', 'other']),
  title: z.string().min(5), description: z.string().max(2000), severity: z.enum(['low', 'medium', 'high', 'critical']), evidence_photo: z.string().optional() });

// API ROUTES
app.post('/api/guard/auth/login', async (req: Request, res: Response) => {
  try {
    const { email, password } = LoginSchema.parse(req.body);
    const officer = await db('security_officers').where('email', email).first();
    if (!officer) return res.status(401).json({ error: 'Invalid credentials' });

    const valid = await bcrypt.compare(password, officer.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

    const token = jwt.sign({ officerId: officer.id, role: 'guard' }, config.jwtSecret, { expiresIn: '7d' });
    httpRequestsTotal.inc({ method: 'POST', path: '/api/guard/auth/login', status: '200' });
    res.json({ token, officer: { id: officer.id, name: `${officer.first_name} ${officer.last_name}`, photo_url: officer.profile_photo_url } });
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: 'Validation error', details: error.errors });
    logger.error('Login error:', error); res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/guard/shifts', authenticate, async (req: Request, res: Response) => {
  try {
    const officerId = (req as any).officerId;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);

    const shifts = await db('shifts').select('shifts.*', 'venues.name as venue_name', 'venues.address as venue_address')
      .leftJoin('venues', 'shifts.venue_id', 'venues.id').where('shifts.officer_id', officerId)
      .where('shifts.start_time', '>=', today).where('shifts.start_time', '<', tomorrow).whereIn('shifts.status', ['scheduled', 'clocked_in'])
      .orderBy('shifts.start_time', 'asc');

    activeGuardsGauge.set(shifts.filter((s) => s.status === 'clocked_in').length);
    httpRequestsTotal.inc({ method: 'GET', path: '/api/guard/shifts', status: '200' });
    res.json(shifts);
  } catch (error) { logger.error('Shift fetch error:', error); res.status(500).json({ error: 'Internal server error' }); }
});

app.post('/api/guard/shifts/:id/clock-in', authenticate, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const data = ClockInSchema.parse(req.body);
    const officerId = (req as any).officerId;

    const [shift] = await db('shifts').where('id', id).where('officer_id', officerId)
      .update({ status: 'clocked_in', clock_in_time: new Date(), clock_in_location: JSON.stringify({ lat: data.latitude, lng: data.longitude }), updated_at: new Date() })
      .returning('*');

    if (!shift) return res.status(404).json({ error: 'Shift not found' });

    const nats = await getNATS();
    await nats.jetstream().publish('guard.clocked_in',
      stringCodec.encode(JSON.stringify({ officer_id: officerId, shift_id: id, location: { lat: data.latitude, lng: data.longitude }, timestamp: new Date().toISOString() })), { msgID: uuidv4() });

    activeGuardsGauge.inc();
    httpRequestsTotal.inc({ method: 'POST', path: '/api/guard/shifts/:id/clock-in', status: '200' });
    res.json({ success: true, shift });
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: 'Validation error', details: error.errors });
    logger.error('Clock in error:', error); res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/guard/shifts/:id/clock-out', authenticate, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { latitude, longitude } = ClockInSchema.parse(req.body);
    const officerId = (req as any).officerId;

    const [shift] = await db('shifts').where('id', id).where('officer_id', officerId)
      .update({ status: 'clocked_out', clock_out_time: new Date(), clock_out_location: JSON.stringify({ lat: latitude, lng: longitude }), updated_at: new Date() })
      .returning('*');

    if (!shift) return res.status(404).json({ error: 'Shift not found' });

    const nats = await getNATS();
    await nats.jetstream().publish('guard.clocked_out',
      stringCodec.encode(JSON.stringify({ officer_id: officerId, shift_id: id, location: { lat: latitude, lng: longitude } })), { msgID: uuidv4() });

    activeGuardsGauge.dec();
    httpRequestsTotal.inc({ method: 'POST', path: '/api/guard/shifts/:id/clock-out', status: '200' });
    res.json({ success: true, shift });
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: 'Validation error', details: error.errors });
    logger.error('Clock out error:', error); res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/guard/incidents', authenticate, async (req: Request, res: Response) => {
  try {
    const data = IncidentReportSchema.parse(req.body);
    const officerId = (req as any).officerId;
    const id = uuidv4();

    const [incident] = await db('incidents').insert({
      id, officer_id: officerId, incident_type: data.incident_type, title: data.title, description: data.description,
      severity: data.severity, status: 'open', created_at: new Date(), updated_at: new Date(),
    }).returning('*');

    const nats = await getNATS();
    await nats.jetstream().publish('guard.incident_reported',
      stringCodec.encode(JSON.stringify({ type: 'INCIDENT_REPORTED', payload: incident })), { msgID: uuidv4() });

    httpRequestsTotal.inc({ method: 'POST', path: '/api/guard/incidents', status: '201' });
    res.status(201).json(incident);
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: 'Validation error', details: error.errors });
    logger.error('Incident error:', error); res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/guard/profile', authenticate, async (req: Request, res: Response) => {
  try {
    const officerId = (req as any).officerId;
    const officer = await db('security_officers').where('id', officerId).first();
    if (!officer) return res.status(404).json({ error: 'Officer not found' });

    const { password_hash, ...profile } = officer;
    httpRequestsTotal.inc({ method: 'GET', path: '/api/guard/profile', status: '200' });
    res.json(profile);
  } catch (error) { logger.error('Profile error:', error); res.status(500).json({ error: 'Internal server error' }); }
});

app.post('/api/guard/location', authenticate, async (req: Request, res: Response) => {
  try {
    const { latitude, longitude } = req.body;
    const officerId = (req as any).officerId;
    const redis = await getRedis();

    await redis.setEx(`guard:${officerId}:location`, 300, JSON.stringify({ lat: latitude, lng: longitude, ts: new Date().toISOString() }));
    await db('officer_locations').insert({ id: uuidv4(), officer_id: officerId, latitude, longitude, timestamp: new Date(), created_at: new Date() });

    httpRequestsTotal.inc({ method: 'POST', path: '/api/guard/location', status: '200' });
    res.json({ success: true });
  } catch (error) { logger.error('Location error:', error); res.status(500).json({ error: 'Internal server error' }); }
});

app.use((err: Error, req: Request, res: Response, next: NextFunction) => { logger.error('Unhandled error:', err); res.status(500).json({ error: 'Internal server error' }); });

async function startServer() {
  try {
    await getRedis();
    await getNATS();
    await db.raw('SELECT 1');
    logger.info('PostgreSQL connected');
    app.listen(config.port, () => logger.info(`Guard App Service running on port ${config.port}`));
  } catch (error) { logger.error('Failed to start server:', error); process.exit(1); }
}

process.on('SIGTERM', async () => { logger.info('SIGTERM, shutting down'); await db.destroy(); if (redisClient) await redisClient.quit(); if (nc) await nc.close(); process.exit(0); });
process.on('SIGINT', async () => { logger.info('SIGINT, shutting down'); await db.destroy(); if (redisClient) await redisClient.quit(); if (nc) await nc.close(); process.exit(0); });

startServer();
export default app;