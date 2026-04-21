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
  postgres: { host: string; port: number; database: string; user: string; password: string };
  redis: { host: string; port: number };
  nats: { url: string };
}

const config: Config = {
  port: parseInt(process.env.PORT || '3003', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
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
  level: process.env.LOG_LEVEL || 'debug',
  format: winston.format.combine(winston.format.timestamp(), winston.format.errors({ stack: true }), winston.format.json()),
  defaultMeta: { service: 'on-demand-service' },
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

const bookingsCreated = new Counter({ name: 'bookings_created_total', help: 'Total bookings created', registers: [metricsRegistry] });
const bookingsCompleted = new Counter({ name: 'bookings_completed_total', help: 'Total bookings completed', registers: [metricsRegistry] });

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

const BookingRequestSchema = z.object({
  venue_id: z.string().uuid(),
  requested_by: z.string().uuid(),
  requested_date: z.string().datetime(),
  duration_hours: z.number().min(1).max(12),
  officer_count: z.number().min(1).max(10),
  special_instructions: z.string().max(2000).optional(),
  urgency: z.enum(['normal', 'high', 'emergency']).default('normal'),
  service_type: z.enum(['event', 'patrol', 'checkpoint', 'personal_protection', 'crowd_control']).default('event'),
});

const BookingConfirmSchema = z.object({
  booking_id: z.string().uuid(),
  assigned_officers: z.array(z.string().uuid()).min(1),
  confirm_price: z.number().positive(),
});

const BookingUpdateSchema = z.object({
  status: z.enum(['pending', 'confirmed', 'in_progress', 'completed', 'cancelled', 'no_show']).optional(),
  officer_count: z.number().min(1).max(10).optional(),
  notes: z.string().max(2000).optional(),
});

// ============================================
// HELPER FUNCTIONS
// ============================================

async function findAvailableOfficers(date: Date, hours: number, count: number): Promise<string[]> {
  const startWindow = new Date(date);
  startWindow.setHours(startWindow.getHours() - 1);
  const endWindow = new Date(date);
  endWindow.setHours(endWindow.getHours() + hours + 1);

  const bookedOfficers = await db('shifts')
    .select('officer_id')
    .where('start_time', '<', endWindow)
    .where('end_time', '>', startWindow)
    .whereIn('status', ['scheduled', 'clocked_in']);

  const bookedIds = bookedOfficers.map((o) => o.officer_id);

  const available = await db('security_officers')
    .select('id')
    .where('status', 'active')
    .whereNotIn('id', bookedIds)
    .limit(count);

  return available.map((a) => a.id);
}

async function calculateBookingPrice(officerCount: number, hours: number, serviceType: string, urgency: string): Promise<number> {
  const baseRate = await db('settings').where('key', 'base_hourly_rate').first();
  const base = baseRate ? parseFloat(baseRate.value) : 250;

  let multiplier = 1;
  if (serviceType === 'personal_protection') multiplier = 2;
  else if (serviceType === 'checkpoint') multiplier = 1.5;
  else if (serviceType === 'crowd_control') multiplier = 1.3;

  if (urgency === 'high') multiplier *= 1.5;
  else if (urgency === 'emergency') multiplier *= 2.5;

  return base * hours * officerCount * multiplier;
}

// ============================================
// API ROUTES
// ============================================

// POST /bookings/request - Create booking request
app.post('/api/on-demand/bookings/request', async (req: Request, res: Response) => {
  const startTime = Date.now();
  try {
    const data = BookingRequestSchema.parse(req.body);

    const [venue] = await db('venues').where('id', data.venue_id).select('name', 'subscription_tier');
    if (!venue) return res.status(404).json({ error: 'Venue not found' });

    const id = uuidv4();
    const estimatedPrice = await calculateBookingPrice(data.officer_count, data.duration_hours, data.service_type, data.urgency);

    const [booking] = await db('on_demand_bookings').insert({
      id,
      venue_id: data.venue_id,
      requested_by: data.requested_by,
      requested_date: data.requested_date,
      duration_hours: data.duration_hours,
      officer_count: data.officer_count,
      special_instructions: data.special_instructions,
      urgency: data.urgency,
      service_type: data.service_type,
      estimated_price: estimatedPrice,
      status: 'pending',
      created_at: new Date(),
      updated_at: new Date(),
    }).returning('*');

    const nats = await getNATS();
    await nats.jetstream().publish('on-demand.bookings.requested',
      stringCodec.encode(JSON.stringify({ type: 'BOOKING_REQUESTED', payload: booking })), { msgID: uuidv4() });

    bookingsCreated.inc();
    httpRequestsTotal.inc({ method: 'POST', path: '/api/on-demand/bookings/request', status: '201' });
    httpRequestDuration.observe({ method: 'POST', path: '/api/on-demand/bookings/request', status: '201' }, (Date.now() - startTime) / 1000);

    res.status(201).json(booking);
  } catch (error) {
    if (error instanceof z.ZodError) {
      httpRequestsTotal.inc({ method: 'POST', path: '/api/on-demand/bookings/request', status: '400' });
      return res.status(400).json({ error: 'Validation error', details: error.errors });
    }
    logger.error('Error creating booking request:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /bookings - List bookings
app.get('/api/on-demand/bookings', async (req: Request, res: Response) => {
  try {
    const { venue_id, status, date_from, date_to } = req.query;
    let query = db('on_demand_bookings').select('on_demand_bookings.*', 'venues.name as venue_name')
      .leftJoin('venues', 'on_demand_bookings.venue_id', 'venues.id')
      .orderBy('on_demand_bookings.requested_date', 'asc');

    if (venue_id) query = query.where('on_demand_bookings.venue_id', venue_id as string);
    if (status) query = query.where('on_demand_bookings.status', status as string);
    if (date_from || date_to) {
      query = query.where(function () {
        if (date_from) this.where('on_demand_bookings.requested_date', '>=', date_from);
        if (date_to) this.where('on_demand_bookings.requested_date', '<=', date_to);
      });
    }

    const bookings = await query;
    httpRequestsTotal.inc({ method: 'GET', path: '/api/on-demand/bookings', status: '200' });
    res.json(bookings);
  } catch (error) {
    logger.error('Error fetching bookings:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /bookings/:id
app.get('/api/on-demand/bookings/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const booking = await db('on_demand_bookings').select('on_demand_bookings.*', 'venues.name as venue_name')
      .leftJoin('venues', 'on_demand_bookings.venue_id', 'venues.id')
      .where('on_demand_bookings.id', id).first();

    if (!booking) {
      httpRequestsTotal.inc({ method: 'GET', path: '/api/on-demand/bookings/:id', status: '404' });
      return res.status(404).json({ error: 'Booking not found' });
    }
    httpRequestsTotal.inc({ method: 'GET', path: '/api/on-demand/bookings/:id', status: '200' });
    res.json(booking);
  } catch (error) {
    logger.error('Error fetching booking:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /bookings/confirm - Confirm booking with officers
app.post('/api/on-demand/bookings/confirm', async (req: Request, res: Response) => {
  try {
    const { booking_id, assigned_officers, confirm_price } = BookingConfirmSchema.parse(req.body);

    const booking = await db('on_demand_bookings').where('id', booking_id).first();
    if (!booking) return res.status(404).json({ error: 'Booking not found' });
    if (booking.status !== 'pending') return res.status(400).json({ error: 'Booking already processed' });

    const [updated] = await db('on_demand_bookings').where('id', booking_id).update({
      assigned_officers,
      confirmed_price: confirm_price,
      status: 'confirmed',
      updated_at: new Date(),
    }).returning('*');

    const nats = await getNATS();
    await nats.jetstream().publish('on-demand.bookings.confirmed',
      stringCodec.encode(JSON.stringify({ type: 'BOOKING_CONFIRMED', payload: updated })), { msgID: uuidv4() });

    httpRequestsTotal.inc({ method: 'POST', path: '/api/on-demand/bookings/confirm', status: '200' });
    res.json(updated);
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: 'Validation error', details: error.errors });
    logger.error('Error confirming booking:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /bookings/:id
app.put('/api/on-demand/bookings/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const data = BookingUpdateSchema.parse(req.body);

    const existing = await db('on_demand_bookings').where('id', id).first();
    if (!existing) return res.status(404).json({ error: 'Booking not found' });

    const [updated] = await db('on_demand_bookings').where('id', id).update({ ...data, updated_at: new Date() }).returning('*');

    const nats = await getNATS();
    await nats.jetstream().publish('on-demand.bookings.updated',
      stringCodec.encode(JSON.stringify({ type: 'BOOKING_UPDATED', payload: updated })), { msgID: uuidv4() });

    if (data.status === 'completed') bookingsCompleted.inc();

    httpRequestsTotal.inc({ method: 'PUT', path: '/api/on-demand/bookings/:id', status: '200' });
    res.json(updated);
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: 'Validation error', details: error.errors });
    logger.error('Error updating booking:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /bookings/:id/cancel
app.post('/api/on-demand/bookings/:id/cancel', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    const existing = await db('on_demand_bookings').where('id', id).first();
    if (!existing) return res.status(404).json({ error: 'Booking not found' });
    if (existing.status === 'completed' || existing.status === 'cancelled') {
      return res.status(400).json({ error: 'Cannot cancel this booking' });
    }

    const [updated] = await db('on_demand_bookings').where('id', id).update({
      status: 'cancelled',
      cancellation_reason: reason,
      updated_at: new Date(),
    }).returning('*');

    const nats = await getNATS();
    await nats.jetstream().publish('on-demand.bookings.cancelled',
      stringCodec.encode(JSON.stringify({ type: 'BOOKING_CANCELLED', payload: updated })), { msgID: uuidv4() });

    httpRequestsTotal.inc({ method: 'POST', path: '/api/on-demand/bookings/:id/cancel', status: '200' });
    res.json(updated);
  } catch (error) {
    logger.error('Error cancelling booking:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /availability/check
app.get('/api/on-demand/availability/check', async (req: Request, res: Response) => {
  try {
    const { date, hours, count } = req.query;
    if (!date || !hours || !count) return res.status(400).json({ error: 'date, hours, count required' });

    const targetDate = new Date(date as string);
    const availableIds = await findAvailableOfficers(targetDate, parseInt(hours as string), parseInt(count as string));

    httpRequestsTotal.inc({ method: 'GET', path: '/api/on-demand/availability/check', status: '200' });
    res.json({
      date,
      hours: parseInt(hours as string),
      requested_count: parseInt(count as string),
      available_count: availableIds.length,
      available_officers: availableIds,
      sufficient: availableIds.length >= parseInt(count as string),
    });
  } catch (error) {
    logger.error('Error checking availability:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /price/estimate
app.get('/api/on-demand/price/estimate', async (req: Request, res: Response) => {
  try {
    const { officer_count, hours, service_type, urgency } = req.query;
    if (!officer_count || !hours || !service_type) return res.status(400).json({ error: 'officer_count, hours, service_type required' });

    const price = await calculateBookingPrice(
      parseInt(officer_count as string),
      parseInt(hours as string),
      service_type as string,
      (urgency as string) || 'normal'
    );

    httpRequestsTotal.inc({ method: 'GET', path: '/api/on-demand/price/estimate', status: '200' });
    res.json({ officer_count: parseInt(officer_count as string), hours: parseInt(hours as string), service_type, urgency, estimated_price: price });
  } catch (error) {
    logger.error('Error estimating price:', error);
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
      logger.info(`On-Demand Service running on port ${config.port}`);
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