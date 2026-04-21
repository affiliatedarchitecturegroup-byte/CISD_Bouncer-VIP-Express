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

const config = { port: parseInt(process.env.PORT || '3009', 10), nodeEnv: process.env.NODE_ENV || 'development',
  postgres: { host: process.env.POSTGRES_HOST || 'localhost', port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
    database: process.env.POSTGRES_DB || 'bouncer_express', user: process.env.POSTGRES_USER || 'bouncer', password: process.env.POSTGRES_PASSWORD || 'dev_password' },
  nats: { url: `nats://${process.env.NATS_HOST || 'localhost'}:${process.env.NATS_PORT || '4222'}` },
};

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'debug',
  format: winston.format.combine(winston.format.timestamp(), winston.format.errors({ stack: true }), winston.format.json()),
  defaultMeta: { service: 'penalty-service' },
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
const penaltiesIssued = new Counter({ name: 'penalties_issued_total', help: 'Total penalties', registers: [metricsRegistry] });

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

// RULES CONFIG
const PENALTY_RULES = {
  late_by_minutes: { threshold: 15, grace_minutes: 5 },
  no_show_hours: { threshold: 2 },
  unauthorized_absences: { threshold: 3 },
  warnings_before_dismissal: 3,
  late_penalty_rate: 50,
  no_show_penalty_rate: 500,
};

// API ROUTES
app.get('/api/penalty/rules', async (req: Request, res: Response) => {
  httpRequestsTotal.inc({ method: 'GET', path: '/api/penalty/rules', status: '200' });
  res.json(PENALTY_RULES);
});

app.post('/api/penalty/check/shifts', async (req: Request, res: Response) => {
  try {
    const { date } = req.body;
    const targetDate = date ? new Date(date) : new Date();
    targetDate.setHours(0, 0, 0, 0);
    const endOfDay = new Date(targetDate); endOfDay.setHours(23, 59, 59, 999);

    // Find late/no-show shifts
    const shifts = await db('shifts').select('shifts.*', 'venues.name as venue_name')
      .leftJoin('venues', 'shifts.venue_id', 'venues.id')
      .where('shifts.start_time', '>=', targetDate).where('shifts.start_time', '<=', endOfDay)
      .whereIn('shifts.status', ['scheduled', 'clocked_in', 'clocked_out']);

    const violations: any[] = [];
    for (const shift of shifts) {
      const scheduledStart = new Date(shift.start_time);
      scheduledStart.setMinutes(scheduledStart.getMinutes() - PENALTY_RULES.late_by_minutes.grace_minutes);

      if (shift.status === 'scheduled') {
        const hoursLate = (new Date().getTime() - scheduledStart.getTime()) / (1000 * 60 * 60);
        if (hoursLate > PENALTY_RULES.no_show_hours.threshold) {
          violations.push({
            shift_id: shift.id, officer_id: shift.officer_id, violation_type: 'no_show',
            minutes_late: Math.floor(hoursLate * 60), penalty_amount: PENALTY_RULES.no_show_penalty_rate,
            scheduled_time: shift.start_time,
          });
        }
      } else if (shift.clock_in_time) {
        const clockIn = new Date(shift.clock_in_time);
        const minutesLate = (clockIn.getTime() - scheduledStart.getTime()) / (1000 * 60);
        if (minutesLate > PENALTY_RULES.late_by_minutes.threshold) {
          violations.push({
            shift_id: shift.id, officer_id: shift.officer_id, violation_type: 'late',
            minutes_late: Math.floor(minutesLate), penalty_amount: Math.floor(minutesLate / 15) * PENALTY_RULES.late_penalty_rate,
            scheduled_time: shift.start_time, clock_in_time: shift.clock_in_time,
          });
        }
      }
    }

    httpRequestsTotal.inc({ method: 'POST', path: '/api/penalty/check/shifts', status: '200' });
    res.json({ checked_at: new Date().toISOString(), violations: violations.length, details: violations });
  } catch (error) { logger.error('Check error:', error); res.status(500).json({ error: 'Internal server error' }); }
});

app.post('/api/penalty/issue', async (req: Request, res: Response) => {
  try {
    const { shift_id, officer_id, violation_type, minutes_late, penalty_amount, reason } = req.body;
    const id = uuidv4();

    const [penalty] = await db('penalties').insert({
      id, shift_id, officer_id, violation_type, minutes_late, penalty_amount, reason,
      status: 'pending', created_at: new Date(),
    }).returning('*');

    penaltiesIssued.inc();
    
    const nats = await getNATS();
    await nats.jetstream().publish('penalty.issued',
      stringCodec.encode(JSON.stringify({ type: 'PENALTY_ISSUED', payload: penalty })), { msgID: uuidv4() });

    httpRequestsTotal.inc({ method: 'POST', path: '/api/penalty/issue', status: '201' });
    res.status(201).json(penalty);
  } catch (error) { logger.error('Issue error:', error); res.status(500).json({ error: 'Internal server error' }); }
});

app.get('/api/penalty/officer/:officer_id', async (req: Request, res: Response) => {
  try {
    const { officer_id } = req.params;
    const penalties_data = await db('penalties').where('officer_id', officer_id).orderBy('created_at', 'desc').limit(50);

    const summary = {
      total_penalties: penalties_data.length,
      total_amount: penalties_data.reduce((sum, p) => sum + (p.penalty_amount || 0), 0),
      late_violations: penalties_data.filter((p) => p.violation_type === 'late').length,
      no_show_violations: penalties_data.filter((p) => p.violation_type === 'no_show').length,
      pending: penalties_data.filter((p) => p.status === 'pending').length,
      paid: penalties_data.filter((p) => p.status === 'paid').length,
    };

    httpRequestsTotal.inc({ method: 'GET', path: '/api/penalty/officer/:officer_id', status: '200' });
    res.json({ officer_id, summary, penalties: penalties_data });
  } catch (error) { logger.error('Fetch error:', error); res.status(500).json({ error: 'Internal server error' }); }
});

app.put('/api/penalty/:id/pay', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const [updated] = await db('penalties').where('id', id).update({ status: 'paid', paid_at: new Date() }).returning('*');
    if (!updated) return res.status(404).json({ error: 'Penalty not found' });
    httpRequestsTotal.inc({ method: 'PUT', path: '/api/penalty/:id/pay', status: '200' });
    res.json(updated);
  } catch (error) { logger.error('Pay error:', error); res.status(500).json({ error: 'Internal server error' }); }
});

app.put('/api/penalty/:id/appeal', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { appeal_reason } = req.body;
    const [updated] = await db('penalties').where('id', id).update({ status: 'appealed', appeal_reason, appealed_at: new Date() }).returning('*');
    if (!updated) return res.status(404).json({ error: 'Penalty not found' });
    httpRequestsTotal.inc({ method: 'PUT', path: '/api/penalty/:id/appeal', status: '200' });
    res.json(updated);
  } catch (error) { logger.error('Appeal error:', error); res.status(500).json({ error: 'Internal server error' }); }
});

app.get('/api/penalty/disciplinary/:officer_id', async (req: Request, res: Response) => {
  try {
    const { officer_id } = req.params;
    const penalties_data = await db('penalties').where('officer_id', officer_id).whereIn('status', ['pending', 'appealed'])
      .orderBy('created_at', 'desc').limit(20);

    const disciplinaryAction = penalties_data.length >= PENALTY_RULES.warnings_before_dismissal ? 'dismissal' : 
      penalties_data.length >= 2 ? 'final_warning' : penalties_data.length >= 1 ? 'verbal_warning' : 'none';

    httpRequestsTotal.inc({ method: 'GET', path: '/api/penalty/disciplinary/:officer_id', status: '200' });
    res.json({ officer_id, penalty_count: penalties_data.length, disciplinary_action, warnings_threshold: PENALTY_RULES.warnings_before_dismissal });
  } catch (error) { logger.error('Disciplinary error:', error); res.status(500).json({ error: 'Internal server error' }); }
});

app.use((err: Error, req: Request, res: Response, next: NextFunction) => { logger.error('Unhandled error:', err); res.status(500).json({ error: 'Internal server error' }); });

async function startServer() {
  try { await getNATS(); await db.raw('SELECT 1'); logger.info('PostgreSQL connected');
    app.listen(config.port, () => logger.info(`Penalty Service running on port ${config.port}`));
  } catch (error) { logger.error('Failed to start server:', error); process.exit(1); }
}

process.on('SIGTERM', async () => { logger.info('SIGTERM, shutting down'); await db.destroy(); if (nc) await nc.close(); process.exit(0); });
process.on('SIGINT', async () => { logger.info('SIGINT, shutting down'); await db.destroy(); if (nc) await nc.close(); process.exit(0); });

startServer();
export default app;