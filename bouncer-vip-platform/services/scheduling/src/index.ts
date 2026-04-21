import dotenv from 'dotenv';
import express, { Express, Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import { createClient, RedisClientType } from 'redis';
import knex, { Knex } from 'knex';
import { Registry, Counter, Histogram } from 'prom-client';
import { connect, JetStreamClient, StringCodec } from 'nats';
import winston from 'winston';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';

dotenv.config();

// ============================================
// CONFIGURATION
// ============================================

interface Config {
  port: number;
  nodeEnv: string;
  logLevel: string;
  postgres: { host: string; port: number; database: string; user: string; password: string };
  redis: { host: string; port: number };
  nats: { url: string };
}

const config: Config = {
  port: parseInt(process.env.PORT || '3002', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  logLevel: process.env.LOG_LEVEL || 'debug',
  postgres: {
    host: process.env.POSTGRES_HOST || 'localhost',
    port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
    database: process.env.POSTGRES_DB || 'bouncer_express',
    user: process.env.POSTGRES_USER || 'bouncer',
    password: process.env.POSTGRES_PASSWORD || 'dev_password',
  },
  redis: { host: process.env.REDIS_HOST || 'localhost', port: parseInt(process.env.REDIS_PORT || '6379', 10) },
  nats: { url: `nats://${process.env.NATS_HOST || 'localhost'}:${process.env.NATS_PORT || '4222'}` },
};

// ============================================
// LOGGING
// ============================================

const logger = winston.createLogger({
  level: config.logLevel,
  format: winston.format.combine(winston.format.timestamp(), winston.format.errors({ stack: true }), winston.format.json()),
  defaultMeta: { service: 'scheduling-service' },
  transports: [new winston.transports.Console({ format: winston.format.combine(winston.format.colorize(), winston.format.simple()) })],
});

if (config.nodeEnv === 'production') {
  logger.add(new winston.transports.File({ filename: 'logs/error.log', level: 'error' }));
  logger.add(new winston.transports.File({ filename: 'logs/combined.log' }));
}

// ============================================
// DATABASE
// ============================================

const db: Knex = knex({ client: 'pg', connection: config.postgres, pool: { min: 2, max: 10 } });

// ============================================
// REDIS
// ============================================

let redisClient: RedisClientType;

async function getRedis(): Promise<RedisClientType> {
  if (!redisClient) {
    redisClient = createClient({ socket: { host: config.redis.host, port: config.redis.port } });
    redisClient.on('error', (err) => logger.error('Redis error:', err));
    await redisClient.connect();
    logger.info('Redis connected');
  }
  return redisClient;
}

// ============================================
// NATS
// ============================================

let nc: JetStreamClient;
let stringCodec: StringCodec;

async function getNATS(): Promise<JetStreamClient> {
  if (!nc) {
    nc = await connect({ servers: config.nats.url });
    stringCodec = new StringCodec();
    logger.info('NATS connected');
  }
  return nc;
}

// ============================================
// METRICS
// ============================================

export const metricsRegistry = new Registry();

const httpRequestsTotal = new Counter({
  name: 'http_requests_total', help: 'Total HTTP requests', labelNames: ['method', 'path', 'status'], registers: [metricsRegistry],
});

const httpRequestDuration = new Histogram({
  name: 'http_request_duration_seconds', help: 'Duration of HTTP requests', labelNames: ['method', 'path', 'status'],
  buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 5], registers: [metricsRegistry],
});

// ============================================
// EXPRESS
// ============================================

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

app.get('/metrics', async (req: Request, res: Response) => {
  res.set('Content-Type', metricsRegistry.contentType);
  res.send(await metricsRegistry.metrics());
});

app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// ============================================
// VALIDATION SCHEMAS
// ============================================

const ShiftCreateSchema = z.object({
  venue_id: z.string().uuid(),
  officer_id: z.string().uuid(),
  start_time: z.string().datetime(),
  end_time: z.string().datetime(),
  hourly_rate: z.number().positive().optional(),
  recurring_pattern: z.enum(['none', 'daily', 'weekly', 'monthly']).default('none'),
  notes: z.string().max(1000).optional(),
});

const ShiftUpdateSchema = ShiftCreateSchema.partial();

const ShiftAssignSchema = z.object({ shift_id: z.string().uuid(), officer_id: z.string().uuid() });

const BulkScheduleSchema = z.object({
  venue_id: z.string().uuid(),
  officer_ids: z.array(z.string().uuid()).min(1),
  start_date: z.string().date(),
  end_date: z.string().date(),
  start_time: z.string().regex(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/),
  end_time: z.string().regex(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/),
  days_of_week: z.array(z.number().min(0).max(6)).optional(),
});

// ============================================
// CONFLICT DETECTION
// ============================================

async function detectConflicts(officerId: string, startTime: Date, endTime: Date, excludeShiftId?: string): Promise<boolean> {
  const query = db('shifts').where('officer_id', officerId).where(function () {
    this.where(function () {
      this.where('start_time', '<', endTime).andWhere('end_time', '>', startTime);
    });
  }).whereIn('status', ['scheduled', 'clocked_in']);

  if (excludeShiftId) query.whereNot('id', excludeShiftId);
  const conflicts = await query.first();
  return !!conflicts;
}

// ============================================
// API ROUTES
// ============================================

// GET /shifts
app.get('/api/scheduling/shifts', async (req: Request, res: Response) => {
  try {
    const { venue_id, officer_id, date_from, date_to, status } = req.query;
    let query = db('shifts').select('shifts.*', 'venues.name as venue_name',
      db.raw("concat(security_officers.first_name, ' ', security_officers.last_name) as officer_name"))
      .leftJoin('venues', 'shifts.venue_id', 'venues.id')
      .leftJoin('security_officers', 'shifts.officer_id', 'security_officers.id')
      .orderBy('shifts.start_time', 'asc');

    if (venue_id) query = query.where('shifts.venue_id', venue_id as string);
    if (officer_id) query = query.where('shifts.officer_id', officer_id as string);
    if (status) query = query.where('shifts.status', status as string);
    if (date_from || date_to) {
      query = query.where(function () {
        if (date_from) this.where('shifts.start_time', '>=', date_from);
        if (date_to) this.where('shifts.start_time', '<=', date_to);
      });
    }
    const shifts = await query;
    httpRequestsTotal.inc({ method: 'GET', path: '/api/scheduling/shifts', status: '200' });
    res.json(shifts);
  } catch (error) {
    logger.error('Error fetching shifts:', error);
    httpRequestsTotal.inc({ method: 'GET', path: '/api/scheduling/shifts', status: '500' });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /shifts/:id
app.get('/api/scheduling/shifts/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const shift = await db('shifts').select('shifts.*', 'venues.name as venue_name',
      db.raw("concat(security_officers.first_name, ' ', security_officers.last_name) as officer_name"))
      .leftJoin('venues', 'shifts.venue_id', 'venues.id')
      .leftJoin('security_officers', 'shifts.officer_id', 'security_officers.id')
      .where('shifts.id', id).first();
    if (!shift) {
      httpRequestsTotal.inc({ method: 'GET', path: '/api/scheduling/shifts/:id', status: '404' });
      return res.status(404).json({ error: 'Shift not found' });
    }
    httpRequestsTotal.inc({ method: 'GET', path: '/api/scheduling/shifts/:id', status: '200' });
    res.json(shift);
  } catch (error) {
    logger.error('Error fetching shift:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /shifts
app.post('/api/scheduling/shifts', async (req: Request, res: Response) => {
  const startTime = Date.now();
  try {
    const validatedData = ShiftCreateSchema.parse(req.body);
    const start = new Date(validatedData.start_time);
    const end = new Date(validatedData.end_time);

    const hasConflict = await detectConflicts(validatedData.officer_id, start, end);
    if (hasConflict) {
      httpRequestsTotal.inc({ method: 'POST', path: '/api/scheduling/shifts', status: '409' });
      return res.status(409).json({ error: 'Shift conflict detected' });
    }

    const id = uuidv4();
    const [shift] = await db('shifts').insert({
      id, venue_id: validatedData.venue_id, officer_id: validatedData.officer_id,
      start_time: start, end_time: end, hourly_rate: validatedData.hourly_rate,
      recurring_pattern: validatedData.recurring_pattern, notes: validatedData.notes, status: 'scheduled',
      created_at: new Date(), updated_at: new Date(),
    }).returning('*');

    const nats = await getNATS();
    await nats.jetstream().publish('scheduling.shifts.created',
      stringCodec.encode(JSON.stringify({ type: 'SHIFT_CREATED', payload: shift })), { msgID: uuidv4() });

    const redis = await getRedis();
    await redis.del('scheduling:shifts:cache:*');

    httpRequestsTotal.inc({ method: 'POST', path: '/api/scheduling/shifts', status: '201' });
    httpRequestDuration.observe({ method: 'POST', path: '/api/scheduling/shifts', status: '201' }, (Date.now() - startTime) / 1000);
    res.status(201).json(shift);
  } catch (error) {
    if (error instanceof z.ZodError) {
      httpRequestsTotal.inc({ method: 'POST', path: '/api/scheduling/shifts', status: '400' });
      return res.status(400).json({ error: 'Validation error', details: error.errors });
    }
    logger.error('Error creating shift:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /shifts/:id
app.put('/api/scheduling/shifts/:id', async (req: Request, res: Response) => {
  const startTime = Date.now();
  try {
    const { id } = req.params;
    const validatedData = ShiftUpdateSchema.parse(req.body);
    const existing = await db('shifts').where('id', id).first();

    if (!existing) {
      httpRequestsTotal.inc({ method: 'PUT', path: '/api/scheduling/shifts/:id', status: '404' });
      return res.status(404).json({ error: 'Shift not found' });
    }

    if (validatedData.start_time || validatedData.end_time) {
      const start = validatedData.start_time ? new Date(validatedData.start_time) : existing.start_time;
      const end = validatedData.end_time ? new Date(validatedData.end_time) : existing.end_time;
      const officerId = validatedData.officer_id || existing.officer_id;
      const hasConflict = await detectConflicts(officerId, start, end, id);
      if (hasConflict) {
        httpRequestsTotal.inc({ method: 'PUT', path: '/api/scheduling/shifts/:id', status: '409' });
        return res.status(409).json({ error: 'Shift conflict detected' });
      }
    }

    const [shift] = await db('shifts').where('id', id).update({ ...validatedData, updated_at: new Date() }).returning('*');

    const nats = await getNATS();
    await nats.jetstream().publish('scheduling.shifts.updated',
      stringCodec.encode(JSON.stringify({ type: 'SHIFT_UPDATED', payload: shift })), { msgID: uuidv4() });

    httpRequestsTotal.inc({ method: 'PUT', path: '/api/scheduling/shifts/:id', status: '200' });
    httpRequestDuration.observe({ method: 'PUT', path: '/api/scheduling/shifts/:id', status: '200' }, (Date.now() - startTime) / 1000);
    res.json(shift);
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: 'Validation error', details: error.errors });
    logger.error('Error updating shift:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /shifts/:id
app.delete('/api/scheduling/shifts/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const deleted = await db('shifts').where('id', id).delete();
    if (!deleted) {
      httpRequestsTotal.inc({ method: 'DELETE', path: '/api/scheduling/shifts/:id', status: '404' });
      return res.status(404).json({ error: 'Shift not found' });
    }
    const nats = await getNATS();
    await nats.jetstream().publish('scheduling.shifts.deleted',
      stringCodec.encode(JSON.stringify({ type: 'SHIFT_DELETED', payload: { id } })), { msgID: uuidv4() });
    httpRequestsTotal.inc({ method: 'DELETE', path: '/api/scheduling/shifts/:id', status: '204' });
    res.sendStatus(204);
  } catch (error) {
    logger.error('Error deleting shift:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /shifts/assign
app.post('/api/scheduling/shifts/assign', async (req: Request, res: Response) => {
  try {
    const { shift_id, officer_id } = ShiftAssignSchema.parse(req.body);
    const shift = await db('shifts').where('id', shift_id).first();
    if (!shift) return res.status(404).json({ error: 'Shift not found' });

    const hasConflict = await detectConflicts(officer_id, shift.start_time, shift.end_time, shift_id);
    if (hasConflict) return res.status(409).json({ error: 'Shift conflict detected' });

    const [updated] = await db('shifts').where('id', shift_id).update({ officer_id, updated_at: new Date() }).returning('*');
    const nats = await getNATS();
    await nats.jetstream().publish('scheduling.shifts.officer_assigned',
      stringCodec.encode(JSON.stringify({ type: 'OFFICER_ASSIGNED', payload: updated })), { msgID: uuidv4() });

    httpRequestsTotal.inc({ method: 'POST', path: '/api/scheduling/shifts/assign', status: '200' });
    res.json(updated);
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: 'Validation error', details: error.errors });
    logger.error('Error assigning officer:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /shifts/bulk
app.post('/api/scheduling/shifts/bulk', async (req: Request, res: Response) => {
  try {
    const data = BulkScheduleSchema.parse(req.body);
    const shifts: object[] = [];
    const startDate = new Date(data.start_date);
    const endDate = new Date(data.end_date);

    for (const officerId of data.officer_ids) {
      let currentDate = new Date(startDate);
      while (currentDate <= endDate) {
        if (!data.days_of_week || data.days_of_week.includes(currentDate.getDay())) {
          const [sh, sm] = data.start_time.split(':').map(Number);
          const [eh, em] = data.end_time.split(':').map(Number);
          const shiftStart = new Date(currentDate); shiftStart.setHours(sh, sm, 0, 0);
          const shiftEnd = new Date(currentDate); shiftEnd.setHours(eh, em, 0, 0);
          const hasConflict = await detectConflicts(officerId, shiftStart, shiftEnd);
          if (!hasConflict) {
            shifts.push({
              id: uuidv4(), venue_id: data.venue_id, officer_id: officerId,
              start_time: shiftStart, end_time: shiftEnd, status: 'scheduled',
              created_at: new Date(), updated_at: new Date(),
            });
          }
        }
        currentDate.setDate(currentDate.getDate() + 1);
      }
    }

    if (shifts.length > 0) {
      await db('shifts').insert(shifts);
      const nats = await getNATS();
      await nats.jetstream().publish('scheduling.shifts.bulk_created',
        stringCodec.encode(JSON.stringify({ type: 'BULK_SHIFTS_CREATED', count: shifts.length })), { msgID: uuidv4() });
    }
    httpRequestsTotal.inc({ method: 'POST', path: '/api/scheduling/shifts/bulk', status: '201' });
    res.status(201).json({ created: shifts.length });
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: 'Validation error', details: error.errors });
    logger.error('Error bulk scheduling:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /availability
app.get('/api/scheduling/availability', async (req: Request, res: Response) => {
  try {
    const { officer_id, date } = req.query;
    if (!officer_id || !date) return res.status(400).json({ error: 'officer_id and date required' });

    const targetDate = new Date(date as string);
    const dayStart = new Date(targetDate); dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(targetDate); dayEnd.setHours(23, 59, 59, 999);

    const shifts = await db('shifts').where('officer_id', officer_id as string).where('start_time', '>=', dayStart)
      .where('start_time', '<=', dayEnd).whereIn('status', ['scheduled', 'clocked_in']);

    httpRequestsTotal.inc({ method: 'GET', path: '/api/scheduling/availability', status: '200' });
    res.json({ officer_id, date, available: shifts.length === 0,
      shifts: shifts.map((s) => ({ id: s.id, start: s.start_time, end: s.end_time })) });
  } catch (error) {
    logger.error('Error checking availability:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================
// ERROR HANDLER
// ============================================

app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  logger.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// ============================================
// START
// ============================================

async function startServer() {
  try {
    await getRedis();
    await getNATS();
    await db.raw('SELECT 1');
    logger.info('PostgreSQL connected');
    app.listen(config.port, () => {
      logger.info(`Scheduling Service running on port ${config.port}`);
      logger.info(`Environment: ${config.nodeEnv}`);
    });
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

process.on('SIGTERM', async () => {
  logger.info('SIGTERM, shutting down');
  await db.destroy();
  if (redisClient) await redisClient.quit();
  if (nc) await nc.close();
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('SIGINT, shutting down');
  await db.destroy();
  if (redisClient) await redisClient.quit();
  if (nc) await nc.close();
  process.exit(0);
});

startServer();

export default app;