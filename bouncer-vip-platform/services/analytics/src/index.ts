import dotenv from 'dotenv';
import express, { Express, Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import knex, { Knex } from 'knex';
import { Registry, Counter, Histogram } from 'prom-client';
import { connect, JetStreamClient, StringCodec } from 'nats';
import winston from 'winston';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';

dotenv.config();

const config = { port: parseInt(process.env.PORT || '3012', 10), nodeEnv: process.env.NODE_ENV || 'development',
  postgres: { host: process.env.POSTGRES_HOST || 'localhost', port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
    database: process.env.POSTGRES_DB || 'bouncer_express', user: process.env.POSTGRES_USER || 'bouncer', password: process.env.POSTGRES_PASSWORD || 'dev_password' },
  nats: { url: `nats://${process.env.NATS_HOST || 'localhost'}:${process.env.NATS_PORT || '4222'}` },
};

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'debug',
  format: winston.format.combine(winston.format.timestamp(), winston.format.errors({ stack: true }), winston.format.json()),
  defaultMeta: { service: 'analytics-service' },
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

// API ROUTES

// Dashboard overview
app.get('/api/analytics/overview', async (req: Request, res: Response) => {
  try {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const thisMonth = new Date(); thisMonth.setDate(1); thisMonth.setHours(0, 0, 0, 0);
    const thisYear = new Date(); thisYear.setMonth(0, 1);

    const [todayShifts, monthRevenue, yearDeployments, totalOfficers, activeVenues] = await Promise.all([
      db('shifts').where('start_time', '>=', today).count('id as count').first(),
      db('invoices').where('status', 'paid').where('created_at', '>=', thisMonth).sum('total as total').first(),
      db('deployments').where('created_at', '>=', thisYear).count('id as count').first(),
      db('security_officers').count('id as count').first(),
      db('venues').where('status', 'active').count('id as count').first(),
    ]);

    httpRequestsTotal.inc({ method: 'GET', path: '/api/analytics/overview', status: '200' });
    res.json({
      today_shifts: parseInt(todayShifts?.count as string) || 0,
      month_revenue: parseFloat(monthRevenue?.total as string) || 0,
      year_deployments: parseInt(yearDeployments?.count as string) || 0,
      total_officers: parseInt(totalOfficers?.count as string) || 0,
      active_venues: parseInt(activeVenues?.count as string) || 0,
      currency: 'ZAR',
    });
  } catch (error) { logger.error('Overview error:', error); res.status(500).json({ error: 'Internal server error' }); }
});

// Revenue analytics
app.get('/api/analytics/revenue', async (req: Request, res: Response) => {
  try {
    const { period, venue_id } = req.query;
    const now = new Date();
    let startDate = new Date(now); startDate.setMonth(startDate.getMonth() - 1);
    if (period === 'year') { startDate = new Date(now); startDate.setFullYear(startDate.getFullYear() - 1); }
    if (period === 'week') { startDate = new Date(now); startDate.setDate(startDate.getDate() - 7); }

    let query = db('invoices').where('status', 'paid').where('created_at', '>=', startDate);
    if (venue_id) query = query.where('venue_id', venue_id as string);

    const byMonth = await query.select(db.raw("date_trunc('month', created_at) as month")).sum('total as revenue').groupBy('month').orderBy('month');

    const total = await db('invoices').where('status', 'paid').where('created_at', '>=', startDate).sum('total as total').first();
    const avgOrderValue = await db('invoices').where('status', 'paid').where('created_at', '>=', startDate).avg('total as avg').first();

    httpRequestsTotal.inc({ method: 'GET', path: '/api/analytics/revenue', status: '200' });
    res.json({ period, start_date: startDate, total_revenue: parseFloat(total?.total as string) || 0, avg_order_value: parseFloat(avgOrderValue?.avg as string) || 0, breakdown: byMonth });
  } catch (error) { logger.error('Revenue error:', error); res.status(500).json({ error: 'Internal server error' }); }
});

// Officer performance
app.get('/api/analytics/officers/performance', async (req: Request, res: Response) => {
  try {
    const { date_from, date_to } = req.query;
    let dateFilter = '';
    if (date_from && date_to) dateFilter = `AND s.start_time >= '${date_from}' AND s.start_time <= '${date_to}'`;

    const query = `
      SELECT 
        so.id, so.first_name, so.last_name,
        COUNT(s.id) as shifts_completed,
        COALESCE(SUM(EXTRACT(EPOCH FROM (s.end_time - s.start_time)) / 3600), 0) as hours_worked,
        COUNT(CASE WHEN s.status = 'completed' THEN 1 END) as completed_shifts,
        COUNT(CASE WHEN s.status IN ('late', 'no_show') THEN 1 END) as issues
      FROM security_officers so
      LEFT JOIN shifts s ON s.officer_id = so.id ${dateFilter ? dateFilter : "AND s.start_time >= CURRENT_DATE - INTERVAL '30 days'"}
      GROUP BY so.id, so.first_name, so.last_name
      ORDER BY hours_worked DESC
      LIMIT 50
    `;
    const performance = await db.raw(query);

    const avgRating = await db('officer_ratings').avg('rating as avg').first();
    httpRequestsTotal.inc({ method: 'GET', path: '/api/analytics/officers/performance', status: '200' });
    res.json({ officers: performance.rows, avg_rating: parseFloat(avgRating?.avg as string) || 0 });
  } catch (error) { logger.error('Performance error:', error); res.status(500).json({ error: 'Internal server error' }); }
});

// Venue analytics
app.get('/api/analytics/venues', async (req: Request, res: Response) => {
  try {
    const venues = await db('venues').select('*').where('status', 'active');
    const venueStats = await Promise.all(venues.map(async (venue) => {
      const [deployments, revenue, incidents] = await Promise.all([
        db('deployments').where('venue_id', venue.id).count('id as count').first(),
        db('invoices').where('venue_id', venue.id).where('status', 'paid').sum('total as total').first(),
        db('incidents').where('venue_id', venue.id).count('id as count').first(),
      ]);
      return {
        venue_id: venue.id, name: venue.name, address: venue.address,
        total_deployments: parseInt(deployments?.count as string) || 0,
        total_revenue: parseFloat(revenue?.total as string) || 0,
        total_incidents: parseInt(incidents?.count as string) || 0,
      };
    }));

    httpRequestsTotal.inc({ method: 'GET', path: '/api/analytics/venues', status: '200' });
    res.json(venueStats.sort((a, b) => b.total_revenue - a.total_revenue));
  } catch (error) { logger.error('Venue error:', error); res.status(500).json({ error: 'Internal server error' }); }
});

// Incident trends
app.get('/api/analytics/incidents/trends', async (req: Request, res: Response) => {
  try {
    const { period } = req.query;
    const now = new Date();
    let startDate = new Date(now); startDate.setMonth(startDate.getMonth() - 1);
    if (period === 'year') { startDate = new Date(now); startDate.setFullYear(startDate.getFullYear() - 1); }

    const trends = await db('incidents').select(db.raw("date_trunc('week', created_at) as week, incident_type, severity, COUNT(*) as count"))
      .where('created_at', '>=', startDate).groupBy('week', 'incident_type', 'severity').orderBy('week');

    const byType = await db('incidents').where('created_at', '>=', startDate).select('incident_type').count('id as count').groupBy('incident_type');
    const bySeverity = await db('incidents').where('created_at', '>=', startDate).select('severity').count('id as count').groupBy('severity');

    httpRequestsTotal.inc({ method: 'GET', path: '/api/analytics/incidents/trends', status: '200' });
    res.json({ trends, by_type: byType, by_severity: bySeverity });
  } catch (error) { logger.error('Trends error:', error); res.status(500).json({ error: 'Internal server error' }); }
});

// Attendance analytics
app.get('/api/analytics/attendance', async (req: Request, res: Response) => {
  try {
    const { date_from, date_to } = req.query;
    let startDate = new Date(); startDate.setDate(startDate.getDate() - 30);
    let endDate = new Date();
    if (date_from) startDate = new Date(date_from as string);
    if (date_to) endDate = new Date(date_to as string);

    const shifts = await db('shifts').select('status', db.raw("DATE(start_time) as date"))
      .where('start_time', '>=', startDate).where('start_time', '<=', endDate);

    const stats = { scheduled: 0, completed: 0, late: 0, no_show: 0, cancelled: 0 };
    shifts.forEach((s) => { if (stats[s.status as keyof typeof stats] !== undefined) stats[s.status as keyof typeof stats]++; });

    const onTimeRate = stats.completed / (stats.completed + stats.late) * 100;
    const attendanceRate = (stats.completed + stats.late) / (stats.scheduled || 1) * 100;

    httpRequestsTotal.inc({ method: 'GET', path: '/api/analytics/attendance', status: '200' });
    res.json({ period: { start: startDate, end: endDate }, stats, on_time_rate: onTimeRate.toFixed(2), attendance_rate: attendanceRate.toFixed(2) });
  } catch (error) { logger.error('Attendance error:', error); res.status(500).json({ error: 'Internal server error' }); }
});

// Custom report builder
app.post('/api/analytics/reports', async (req: Request, res: Response) => {
  try {
    const { name, filters, metrics } = req.body;
    const id = uuidv4();

    const [report] = await db('analytics_reports').insert({
      id, name, filters: filters || {}, metrics: metrics || [],
      created_by: 'system', created_at: new Date(),
    }).returning('*');

    httpRequestsTotal.inc({ method: 'POST', path: '/api/analytics/reports', status: '201' });
    res.status(201).json(report);
  } catch (error) { logger.error('Report error:', error); res.status(500).json({ error: 'Internal server error' }); }
});

app.get('/api/analytics/reports', async (req: Request, res: Response) => {
  try {
    const reports = await db('analytics_reports').orderBy('created_at', 'desc').limit(50);
    httpRequestsTotal.inc({ method: 'GET', path: '/api/analytics/reports', status: '200' });
    res.json(reports);
  } catch (error) { logger.error('Reports error:', error); res.status(500).json({ error: 'Internal server error' }); }
});

app.use((err: Error, req: Request, res: Response, next: NextFunction) => { logger.error('Unhandled error:', err); res.status(500).json({ error: 'Internal server error' }); });

async function startServer() {
  try { await getNATS(); await db.raw('SELECT 1'); logger.info('PostgreSQL connected');
    app.listen(config.port, () => logger.info(`Analytics Service running on port ${config.port}`));
  } catch (error) { logger.error('Failed to start server:', error); process.exit(1); }
}

process.on('SIGTERM', async () => { logger.info('SIGTERM, shutting down'); await db.destroy(); if (nc) await nc.close(); process.exit(0); });
process.on('SIGINT', async () => { logger.info('SIGINT, shutting down'); await db.destroy(); if (nc) await nc.close(); process.exit(0); });

startServer();
export default app;