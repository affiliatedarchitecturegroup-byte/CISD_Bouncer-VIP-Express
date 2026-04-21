import dotenv from 'dotenv';
import express, { Express, Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import { createClient, RedisClientType } from 'redis';
import knex, { Knex } from 'knex';
import { Registry, Counter, Histogram, Gauge } from 'prom-client';
import { connect, JetStreamClient, StringCodec, consumer } from 'nats';
import winston from 'winston';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { Server } from 'http';

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
  port: parseInt(process.env.PORT || '3004', 10),
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
  defaultMeta: { service: 'monitoring-service' },
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

const activeDeploymentsGauge = new Gauge({ name: 'active_deployments', help: 'Number of active deployments', registers: [metricsRegistry] });
const activeIncidentsGauge = new Gauge({ name: 'active_incidents', help: 'Number of active incidents', registers: [metricsRegistry] });
const officersOnDutyGauge = new Gauge({ name: 'officers_on_duty', help: 'Number of officers currently on duty', registers: [metricsRegistry] });

// ============================================
// EXPRESS
// ============================================

const app: Express = express();
const server: Server = new Server(app);

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
// WEBSOCKET FOR LIVE UPDATES
// ============================================

interface WSClient {
  id: string;
  socket: any;
  subscriptions: Set<string>;
}

const wsClients: Map<string, WSClient> = new Map();

function broadcastEvent(channel: string, data: object): void {
  const message = JSON.stringify({ channel, data, timestamp: new Date().toISOString() });
  wsClients.forEach((client) => {
    if (client.subscriptions.has(channel)) {
      client.socket.send(message);
    }
  });
}

function updateGauges(): void {
  db('shifts')
    .whereIn('status', ['clocked_in', 'in_progress'])
    .count('id as count')
    .first()
    .then((result) => {
      if (result) officersOnDutyGauge.set(parseInt(result.count as string) || 0);
    });

  db('deployments').where('status', 'in_progress').count('id as count').first().then((result) => {
    if (result) activeDeploymentsGauge.set(parseInt(result.count as string) || 0);
  });

  db('incidents').where('status', 'open').count('id as count').first().then((result) => {
    if (result) activeIncidentsGauge.set(parseInt(result.count as string) || 0);
  });
}

setInterval(updateGauges, 30000);

// ============================================
// VALIDATION SCHEMAS
// ============================================

const IncidentCreateSchema = z.object({
  venue_id: z.string().uuid(),
  shift_id: z.string().uuid().optional(),
  officer_id: z.string().uuid().optional(),
  incident_type: z.enum(['theft', 'assault', 'breach', 'medical', 'fire', 'noise_complaint', 'trespasser', 'other']),
  severity: z.enum(['low', 'medium', 'high', 'critical']),
  title: z.string().min(5).max(200),
  description: z.string().max(5000),
  location_details: z.string().max(500).optional(),
  persons_involved: z.array(z.string()).max(20).optional(),
  evidence_collected: z.boolean().default(false),
});

const IncidentUpdateSchema = IncidentCreateSchema.partial().extend({
  status: z.enum(['open', 'investigating', 'resolved', 'closed']).optional(),
  resolution_notes: z.string().max(2000).optional(),
});

const LiveLocationSchema = z.object({
  officer_id: z.string().uuid(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracy: z.number().optional(),
  timestamp: z.string().datetime(),
});

// ============================================
// API ROUTES
// ============================================

// GET /dashboard - Real-time dashboard data
app.get('/api/monitoring/dashboard', async (req: Request, res: Response) => {
  try {
    const [activeShifts, activeDeployments, openIncidents, venueAlerts] = await Promise.all([
      db('shifts').whereIn('status', ['scheduled', 'clocked_in']).count('id as count').first(),
      db('deployments').where('status', 'in_progress').count('id as count').first(),
      db('incidents').where('status', 'open').count('id as count').first(),
      db('venues').where('status', 'inactive').count('id as count').first(),
    ]);

    httpRequestsTotal.inc({ method: 'GET', path: '/api/monitoring/dashboard', status: '200' });
    res.json({
      active_shifts: parseInt(activeShifts?.count as string) || 0,
      active_deployments: parseInt(activeDeployments?.count as string) || 0,
      open_incidents: parseInt(openIncidents?.count as string) || 0,
      venue_alerts: parseInt(venueAlerts?.count as string) || 0,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('Error fetching dashboard:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /incidents
app.get('/api/monitoring/incidents', async (req: Request, res: Response) => {
  try {
    const { venue_id, status, severity, date_from, date_to, limit } = req.query;
    let query = db('incidents')
      .select('incidents.*', 'venues.name as venue_name')
      .leftJoin('venues', 'incidents.venue_id', 'venues.id')
      .orderBy('incidents.created_at', 'desc')
      .limit(parseInt(limit as string) || 100);

    if (venue_id) query = query.where('incidents.venue_id', venue_id as string);
    if (status) query = query.where('incidents.status', status as string);
    if (severity) query = query.where('incidents.severity', severity as string);
    if (date_from || date_to) {
      query = query.where(function () {
        if (date_from) this.where('incidents.created_at', '>=', date_from);
        if (date_to) this.where('incidents.created_at', '<=', date_to);
      });
    }

    const incidents = await query;
    httpRequestsTotal.inc({ method: 'GET', path: '/api/monitoring/incidents', status: '200' });
    res.json(incidents);
  } catch (error) {
    logger.error('Error fetching incidents:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /incidents/:id
app.get('/api/monitoring/incidents/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const incident = await db('incidents')
      .select('incidents.*', 'venues.name as venue_name')
      .leftJoin('venues', 'incidents.venue_id', 'venues.id')
      .where('incidents.id', id)
      .first();

    if (!incident) {
      httpRequestsTotal.inc({ method: 'GET', path: '/api/monitoring/incidents/:id', status: '404' });
      return res.status(404).json({ error: 'Incident not found' });
    }
    httpRequestsTotal.inc({ method: 'GET', path: '/api/monitoring/incidents/:id', status: '200' });
    res.json(incident);
  } catch (error) {
    logger.error('Error fetching incident:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /incidents
app.post('/api/monitoring/incidents', async (req: Request, res: Response) => {
  const startTime = Date.now();
  try {
    const data = IncidentCreateSchema.parse(req.body);
    const id = uuidv4();

    const [incident] = await db('incidents')
      .insert({
        id,
        venue_id: data.venue_id,
        shift_id: data.shift_id,
        officer_id: data.officer_id,
        incident_type: data.incident_type,
        severity: data.severity,
        title: data.title,
        description: data.description,
        location_details: data.location_details,
        persons_involved: data.persons_involved,
        evidence_collected: data.evidence_collected,
        status: 'open',
        created_at: new Date(),
        updated_at: new Date(),
      })
      .returning('*');

    const nats = await getNATS();
    await nats.jetstream().publish('monitoring.incident.created',
      stringCodec.encode(JSON.stringify({ type: 'INCIDENT_CREATED', payload: incident, severity: data.severity })), { msgID: uuidv4() });

    broadcastEvent('incidents', { action: 'created', incident });

    httpRequestsTotal.inc({ method: 'POST', path: '/api/monitoring/incidents', status: '201' });
    httpRequestDuration.observe({ method: 'POST', path: '/api/monitoring/incidents', status: '201' }, (Date.now() - startTime) / 1000);
    res.status(201).json(incident);
  } catch (error) {
    if (error instanceof z.ZodError) {
      httpRequestsTotal.inc({ method: 'POST', path: '/api/monitoring/incidents', status: '400' });
      return res.status(400).json({ error: 'Validation error', details: error.errors });
    }
    logger.error('Error creating incident:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /incidents/:id
app.put('/api/monitoring/incidents/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const data = IncidentUpdateSchema.parse(req.body);

    const existing = await db('incidents').where('id', id).first();
    if (!existing) return res.status(404).json({ error: 'Incident not found' });

    const [updated] = await db('incidents').where('id', id).update({ ...data, updated_at: new Date() }).returning('*');

    const nats = await getNATS();
    await nats.jetstream().publish('monitoring.incident.updated',
      stringCodec.encode(JSON.stringify({ type: 'INCIDENT_UPDATED', payload: updated })), { msgID: uuidv4() });

    broadcastEvent('incidents', { action: 'updated', incident: updated });

    httpRequestsTotal.inc({ method: 'PUT', path: '/api/monitoring/incidents/:id', status: '200' });
    res.json(updated);
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: 'Validation error', details: error.errors });
    logger.error('Error updating incident:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /live-tracking/:officer_id
app.get('/api/monitoring/live-tracking/:officer_id', async (req: Request, res: Response) => {
  try {
    const { officer_id } = req.params;
    const { limit } = req.query;

    const locations = await db('officer_locations')
      .where('officer_id', officer_id)
      .orderBy('timestamp', 'desc')
      .limit(parseInt(limit as string) || 50);

    httpRequestsTotal.inc({ method: 'GET', path: '/api/monitoring/live-tracking/:officer_id', status: '200' });
    res.json(locations);
  } catch (error) {
    logger.error('Error fetching location:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /live-tracking
app.post('/api/monitoring/live-tracking', async (req: Request, res: Response) => {
  try {
    const data = LiveLocationSchema.parse(req.body);
    const id = uuidv4();

    await db('officer_locations').insert({
      id,
      officer_id: data.officer_id,
      latitude: data.latitude,
      longitude: data.longitude,
      accuracy: data.accuracy,
      timestamp: new Date(data.timestamp),
      created_at: new Date(),
    });

    const redis = await getRedis();
    await redis.setEx(`officer:${data.officer_id}:location`, 300, JSON.stringify({
      lat: data.latitude, lng: data.longitude, ts: new Date().toISOString()
    }));

    broadcastEvent('locations', { officer_id: data.officer_id, latitude: data.latitude, longitude: data.longitude });

    httpRequestsTotal.inc({ method: 'POST', path: '/api/monitoring/live-tracking', status: '201' });
    res.status(201).json({ success: true });
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: 'Validation error', details: error.errors });
    logger.error('Error tracking location:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /alerts
app.get('/api/monitoring/alerts', async (req: Request, res: Response) => {
  try {
    const alerts = await db('alerts')
      .select('alerts.*', 'venues.name as venue_name')
      .leftJoin('venues', 'alerts.venue_id', 'venues.id')
      .where('alerts.status', 'active')
      .orderBy('alerts.created_at', 'desc')
      .limit(50);

    httpRequestsTotal.inc({ method: 'GET', path: '/api/monitoring/alerts', status: '200' });
    res.json(alerts);
  } catch (error) {
    logger.error('Error fetching alerts:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /alerts
app.post('/api/monitoring/alerts', async (req: Request, res: Response) => {
  try {
    const { venue_id, alert_type, title, message, severity } = req.body;
    const id = uuidv4();

    const [alert] = await db('alerts').insert({
      id, venue_id, alert_type, title, message, severity,
      status: 'active', created_at: new Date(),
    }).returning('*');

    broadcastEvent('alerts', { action: 'created', alert });
    httpRequestsTotal.inc({ method: 'POST', path: '/api/monitoring/alerts', status: '201' });
    res.status(201).json(alert);
  } catch (error) {
    logger.error('Error creating alert:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /deployments/live
app.get('/api/monitoring/deployments/live', async (req: Request, res: Response) => {
  try {
    const deployments = await db('deployments')
      .select('deployments.*', 'venues.name as venue_name')
      .leftJoin('venues', 'deployments.venue_id', 'venues.id')
      .where('deployments.status', 'in_progress')
      .orderBy('deployments.start_time', 'asc');

    const enriched = await Promise.all(deployments.map(async (d) => {
      const officers = await db('shifts')
        .select(db.raw("concat(security_officers.first_name, ' ', security_officers.last_name) as name"))
        .leftJoin('security_officers', 'shifts.officer_id', 'security_officers.id')
        .where('shifts.deployment_id', d.id);
      return { ...d, officers: officers.map((o) => o.name) };
    }));

    httpRequestsTotal.inc({ method: 'GET', path: '/api/monitoring/deployments/live', status: '200' });
    res.json(enriched);
  } catch (error) {
    logger.error('Error fetching live deployments:', error);
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

    updateGauges();
    app.listen(config.port, () => {
      logger.info(`Monitoring Service running on port ${config.port}`);
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