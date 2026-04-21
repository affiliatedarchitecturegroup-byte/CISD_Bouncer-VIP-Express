import dotenv from 'dotenv';
import express, { Express, Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import knex, { Knex } from 'knex';
import { Registry, Counter, Histogram, Gauge } from 'prom-client';
import { connect, JetStreamClient, StringCodec } from 'nats';
import winston from 'winston';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';

dotenv.config();

const config = { port: parseInt(process.env.PORT || '3011', 10), nodeEnv: process.env.NODE_ENV || 'development',
  postgres: { host: process.env.POSTGRES_HOST || 'localhost', port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
    database: process.env.POSTGRES_DB || 'bouncer_express', user: process.env.POSTGRES_USER || 'bouncer', password: process.env.POSTGRES_PASSWORD || 'dev_password' },
  nats: { url: `nats://${process.env.NATS_HOST || 'localhost'}:${process.env.NATS_PORT || '4222'}` },
};

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'debug',
  format: winston.format.combine(winston.format.timestamp(), winston.format.errors({ stack: true }), winston.format.json()),
  defaultMeta: { service: 'psira-compliance-service' },
  transports: [new winston.transports.Console({ format: winston.format.combine(winston.format.colorize(), winston.format.simple()) })],
});

const db: Knex = knex({ client: 'pg', connection: config.postgres, pool: { min: 2, max: 10 } });

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
const expiringRegistrationsGauge = new Gauge({ name: 'expiring_registrations', help: 'Expiring PSIRA registrations', registers: [metricsRegistry] });

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

// PSIRA GRADES
const PSIRA_GRADES = ['A', 'B', 'C', 'D', 'E'] as const;
const REGISTRATION_MONTHS = 12;

// VALIDATION
const RegistrationSchema = z.object({
  officer_id: z.string().uuid(), psira_number: z.string().min(8).max(20), grade: z.enum(PSIRA_GRADES),
  registration_date: z.string().date(), expiry_date: z.string().date(),
});

const ComplianceCheckSchema = z.object({ officer_id: z.string().uuid() });

// API ROUTES
app.get('/api/psira/registrations', async (req: Request, res: Response) => {
  try {
    const { status, grade } = req.query;
    let query = db('psira_registrations').select('psira_registrations.*', 
      db.raw("concat(security_officers.first_name, ' ', security_officers.last_name) as officer_name"))
      .leftJoin('security_officers', 'psira_registrations.officer_id', 'security_officers.id')
      .orderBy('psira_registrations.expiry_date', 'asc');

    if (status === 'active') query = query.where('psira_registrations.status', 'active');
    else if (status === 'expired') query = query.where('psira_registrations.status', 'expired');
    if (grade) query = query.where('psira_registrations.grade', grade as string);

    const registrations = await query;
    httpRequestsTotal.inc({ method: 'GET', path: '/api/psira/registrations', status: '200' });
    res.json(registrations);
  } catch (error) { logger.error('Fetch error:', error); res.status(500).json({ error: 'Internal server error' }); }
});

app.post('/api/psira/registrations', async (req: Request, res: Response) => {
  const startTime = Date.now();
  try {
    const data = RegistrationSchema.parse(req.body);
    const id = uuidv4();

    const [registration] = await db('psira_registrations').insert({
      id, officer_id: data.officer_id, psira_number: data.psira_number, grade: data.grade,
      registration_date: new Date(data.registration_date), expiry_date: new Date(data.expiry_date),
      status: 'active', created_at: new Date(), updated_at: new Date(),
    }).returning('*');

    const nats = await getNATS();
    await nats.jetstream().publish('psira.registered',
      stringCodec.encode(JSON.stringify({ type: 'PSIRA_REGISTERED', officer_id: data.officer_id, psira_number: data.psira_number })), { msgID: uuidv4() });

    httpRequestsTotal.inc({ method: 'POST', path: '/api/psira/registrations', status: '201' });
    httpRequestDuration.observe({ method: 'POST', path: '/api/psira/registrations', status: '201' }, (Date.now() - startTime) / 1000);
    res.status(201).json(registration);
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: 'Validation error', details: error.errors });
    logger.error('Registration error:', error); res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/psira/registrations/:officer_id', async (req: Request, res: Response) => {
  try {
    const { officer_id } = req.params;
    const registration = await db('psira_registrations').where('officer_id', officer_id).first();
    if (!registration) return res.status(404).json({ error: 'Registration not found' });
    httpRequestsTotal.inc({ method: 'GET', path: '/api/psira/registrations/:officer_id', status: '200' });
    res.json(registration);
  } catch (error) { logger.error('Fetch error:', error); res.status(500).json({ error: 'Internal server error' }); }
});

app.put('/api/psira/registrations/:id/renew', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { new_expiry_date } = req.body;

    const existing = await db('psira_registrations').where('id', id).first();
    if (!existing) return res.status(404).json({ error: 'Registration not found' });

    const [updated] = await db('psira_registrations').where('id', id).update({
      expiry_date: new Date(new_expiry_date), status: 'active', renewed_at: new Date(), updated_at: new Date()
    }).returning('*');

    httpRequestsTotal.inc({ method: 'PUT', path: '/api/psira/registrations/:id/renew', status: '200' });
    res.json(updated);
  } catch (error) { logger.error('Renew error:', error); res.status(500).json({ error: 'Internal server error' }); }
});

app.get('/api/psira/expiring', async (req: Request, res: Response) => {
  try {
    const { days } = req.query;
    const daysAhead = parseInt(days as string) || 30;
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + daysAhead);

    const expiring = await db('psira_registrations').select('psira_registrations.*',
      db.raw("concat(security_officers.first_name, ' ', security_officers.last_name) as officer_name"))
      .leftJoin('security_officers', 'psira_registrations.officer_id', 'security_officers.id')
      .where('psira_registrations.status', 'active')
      .where('psira_registrations.expiry_date', '<=', futureDate)
      .orderBy('psira_registrations.expiry_date', 'asc');

    expiringRegistrationsGauge.set(expiring.length);
    httpRequestsTotal.inc({ method: 'GET', path: '/api/psira/expiring', status: '200' });
    res.json({ expiring_in_days: daysAhead, count: expiring.length, registrations: expiring });
  } catch (error) { logger.error('Expiring error:', error); res.status(500).json({ error: 'Internal server error' }); }
});

app.post('/api/psira/check-compliance', async (req: Request, res: Response) => {
  try {
    const { officer_id } = req.body;
    const registration = await db('psira_registrations').where('officer_id', officer_id).where('status', 'active').first();

    if (!registration) {
      httpRequestsTotal.inc({ method: 'POST', path: '/api/psira/check-compliance', status: '400' });
      return res.json({ compliant: false, reason: 'No active PSIRA registration' });
    }

    const now = new Date();
    const expiry = new Date(registration.expiry_date);
    const daysUntilExpiry = Math.ceil((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

    const compliant = daysUntilExpiry > 0;
    const warnings: string[] = [];
    if (daysUntilExpiry <= 30) warnings.push(`Registration expires in ${daysUntilExpiry} days`);
    if (daysUntilExpiry <= 7) warnings.push('URGENT: Registration expires within 7 days');

    httpRequestsTotal.inc({ method: 'POST', path: '/api/psira/check-compliance', status: compliant ? '200' : '400' });
    res.json({
      compliant, officer_id, psira_number: registration.psira_number, grade: registration.grade,
      expiry_date: registration.expiry_date, days_until_expiry: daysUntilExpiry, warnings
    });
  } catch (error) { logger.error('Check error:', error); res.status(500).json({ error: 'Internal server error' }); }
});

app.get('/api/psira/stats', async (req: Request, res: Response) => {
  try {
    const [total, active, expired, expiringSoon] = await Promise.all([
      db('psira_registrations').count('id as count').first(),
      db('psira_registrations').where('status', 'active').count('id as count').first(),
      db('psira_registrations').where('status', 'expired').count('id as count').first(),
      db('psira_registrations').where('status', 'active').where('expiry_date', '<=', new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)).count('id as count').first(),
    ]);

    const grades = await db('psira_registrations').where('status', 'active').select('grade').count('id as count').groupBy('grade');
    const gradeBreakdown = grades.reduce((acc: any, g) => { acc[g.grade] = parseInt(g.count as string); return acc; }, {});

    httpRequestsTotal.inc({ method: 'GET', path: '/api/psira/stats', status: '200' });
    res.json({
      total: total?.count, active: active?.count, expired: expired?.count, expiring_soon: expiringSoon?.count, grade_breakdown: gradeBreakdown
    });
  } catch (error) { logger.error('Stats error:', error); res.status(500).json({ error: 'Internal server error' }); }
});

app.use((err: Error, req: Request, res: Response, next: NextFunction) => { logger.error('Unhandled error:', err); res.status(500).json({ error: 'Internal server error' }); });

async function startServer() {
  try { await getNATS(); await db.raw('SELECT 1'); logger.info('PostgreSQL connected');
    app.listen(config.port, () => logger.info(`PSIRA Compliance Service running on port ${config.port}`));
  } catch (error) { logger.error('Failed to start server:', error); process.exit(1); }
}

process.on('SIGTERM', async () => { logger.info('SIGTERM, shutting down'); await db.destroy(); if (nc) await nc.close(); process.exit(0); });
process.on('SIGINT', async () => { logger.info('SIGINT, shutting down'); await db.destroy(); if (nc) await nc.close(); process.exit(0); });

startServer();
export default app;