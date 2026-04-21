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

// ============================================
// CONFIGURATION
// ============================================

const config = {
  port: parseInt(process.env.PORT || '3005', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  postgres: {
    host: process.env.POSTGRES_HOST || 'localhost',
    port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
    database: process.env.POSTGRES_DB || 'bouncer_express',
    user: process.env.POSTGRES_USER || 'bouncer',
    password: process.env.POSTGRES_PASSWORD || 'dev_password',
  },
  nats: { url: `nats://${process.env.NATS_HOST || 'localhost'}:${process.env.NATS_PORT || '4222'}` },
};

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'debug',
  format: winston.format.combine(winston.format.timestamp(), winston.format.errors({ stack: true }), winston.format.json()),
  defaultMeta: { service: 'erp-service' },
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

const httpRequestsTotal = new Counter({
  name: 'http_requests_total', help: 'Total HTTP requests', labelNames: ['method', 'path', 'status'], registers: [metricsRegistry],
});

const httpRequestDuration = new Histogram({
  name: 'http_request_duration_seconds', help: 'Duration of HTTP requests', labelNames: ['method', 'path', 'status'],
  buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 5], registers: [metricsRegistry],
});

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

const InvoiceSchema = z.object({
  venue_id: z.string().uuid(),
 invoice_type: z.enum(['security_service', 'on_demand', 'monthly', 'adjustment']),
  line_items: z.array(z.object({ description: z.string(), quantity: z.number(), unit_price: z.number(), total: z.number() })),
  due_date: z.string().date(),
  notes: z.string().max(2000).optional(),
});

const PayrollRunSchema = z.object({
  pay_period_start: z.string().date(),
  pay_period_end: z.string().date(),
  officer_ids: z.array(z.string().uuid()).min(1),
  pay_type: z.enum(['hourly', 'salary', 'shift']),
});

// ============================================
// HELPER FUNCTIONS
// ============================================

async function calculateOfficerPay(officerId: string, startDate: Date, endDate: Date): Promise<number> {
  const shifts = await db('shifts').where('officer_id', officerId).where('start_time', '>=', startDate).where('start_time', '<=', endDate)
    .whereIn('status', ['clocked_out', 'completed']);

  let total = 0;
  for (const shift of shifts) {
    const start = new Date(shift.start_time);
    const end = new Date(shift.end_time);
    const hours = (end.getTime() - start.getTime()) / (1000 * 60 * 60);
    const rate = shift.hourly_rate || 250;
    total += hours * rate;
  }
  return total;
}

async function calculateVenueBill(venueId: string, startDate: Date, endDate: Date): Promise<number> {
  const deployments = await db('deployments').where('venue_id', venueId).where('date', '>=', startDate).where('date', '<=', endDate)
    .where('status', 'completed');

  let total = 0;
  for (const d of deployments) {
    const officerCount = d.officer_count || 1;
    const hours = d.total_hours || 8;
    const rate = d.hourly_rate || 350;
    total += officerCount * hours * rate;
  }
  return total;
}

// ============================================
// API ROUTES
// ============================================

// GET /invoices
app.get('/api/erp/invoices', async (req: Request, res: Response) => {
  try {
    const { venue_id, status, date_from, date_to } = req.query;
    let query = db('invoices').select('invoices.*', 'venues.name as venue_name')
      .leftJoin('venues', 'invoices.venue_id', 'venues.id').orderBy('invoices.created_at', 'desc');

    if (venue_id) query = query.where('invoices.venue_id', venue_id as string);
    if (status) query = query.where('invoices.status', status as string);
    if (date_from || date_to) {
      query = query.where(function () {
        if (date_from) this.where('invoices.created_at', '>=', date_from);
        if (date_to) this.where('invoices.created_at', '<=', date_to);
      });
    }
    const invoices = await query;
    httpRequestsTotal.inc({ method: 'GET', path: '/api/erp/invoices', status: '200' });
    res.json(invoices);
  } catch (error) {
    logger.error('Error fetching invoices:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /invoices
app.post('/api/erp/invoices', async (req: Request, res: Response) => {
  const startTime = Date.now();
  try {
    const data = InvoiceSchema.parse(req.body);
    const id = uuidv4();
    const subtotal = data.line_items.reduce((acc, item) => acc + item.total, 0);
    const tax = subtotal * 0.15;
    const total = subtotal + tax;

    const [invoice] = await db('invoices').insert({
      id, venue_id: data.venue_id, invoice_type: data.invoice_type,
      line_items: data.line_items, subtotal, tax, total, due_date: data.due_date,
      notes: data.notes, status: 'pending', created_at: new Date(), updated_at: new Date(),
    }).returning('*');

    const nats = await getNATS();
    await nats.jetstream().publish('erp.invoice.created',
      stringCodec.encode(JSON.stringify({ type: 'INVOICE_CREATED', payload: invoice })), { msgID: uuidv4() });

    httpRequestsTotal.inc({ method: 'POST', path: '/api/erp/invoices', status: '201' });
    httpRequestDuration.observe({ method: 'POST', path: '/api/erp/invoices', status: '201' }, (Date.now() - startTime) / 1000);
    res.status(201).json(invoice);
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: 'Validation error', details: error.errors });
    logger.error('Error creating invoice:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /invoices/:id
app.put('/api/erp/invoices/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { status, paid_at } = req.body;

    const existing = await db('invoices').where('id', id).first();
    if (!existing) return res.status(404).json({ error: 'Invoice not found' });

    const [updated] = await db('invoices').where('id', id).update({
      status, paid_at: paid_at ? new Date(paid_at) : null, updated_at: new Date()
    }).returning('*');

    httpRequestsTotal.inc({ method: 'PUT', path: '/api/erp/invoices/:id', status: '200' });
    res.json(updated);
  } catch (error) {
    logger.error('Error updating invoice:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /payroll
app.get('/api/erp/payroll', async (req: Request, res: Response) => {
  try {
    const { pay_period_start, pay_period_end, officer_id } = req.query;
    if (!pay_period_start || !pay_period_end) return res.status(400).json({ error: 'pay_period_start and pay_period_end required' });

    const start = new Date(pay_period_start as string);
    const end = new Date(pay_period_end as string);

    let query = db('security_officers').select('*').where('status', 'active');
    if (officer_id) query = query.where('id', officer_id as string);

    const officers = await query;
    const payroll = await Promise.all(officers.map(async (officer) => {
      const amount = await calculateOfficerPay(officer.id, start, end);
      return { officer_id: officer.id, name: `${officer.first_name} ${officer.last_name}`, amount, shifts_completed: 0 };
    }));

    httpRequestsTotal.inc({ method: 'GET', path: '/api/erp/payroll', status: '200' });
    res.json({ period_start: start, period_end: end, payroll });
  } catch (error) {
    logger.error('Error calculating payroll:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /payroll/run
app.post('/api/erp/payroll/run', async (req: Request, res: Response) => {
  try {
    const data = PayrollRunSchema.parse(req.body);
    const start = new Date(data.pay_period_start);
    const end = new Date(data.pay_period_end);

    const payslips: object[] = [];
    for (const officerId of data.officer_ids) {
      const officer = await db('security_officers').where('id', officerId).first();
      if (!officer) continue;

      const amount = await calculateOfficerPay(officerId, start, end);
      const id = uuidv4();
      payslips.push({
        id, officer_id: officerId, pay_period_start: start, pay_period_end: end,
        amount, status: 'pending', created_at: new Date(),
      });
    }

    if (payslips.length > 0) {
      await db('payslips').insert(payslips);
      const nats = await getNATS();
      await nats.jetstream().publish('erp.payroll.run',
        stringCodec.encode(JSON.stringify({ type: 'PAYROLL_RUN', count: payslips.length, period: { start, end } })), { msgID: uuidv4() });
    }

    httpRequestsTotal.inc({ method: 'POST', path: '/api/erp/payroll/run', status: '201' });
    res.status(201).json({ created: payslips.length, payslips });
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: 'Validation error', details: error.errors });
    logger.error('Error running payroll:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /reports/revenue
app.get('/api/erp/reports/revenue', async (req: Request, res: Response) => {
  try {
    const { period } = req.query;
    const now = new Date();
    let startDate = new Date(now); startDate.setMonth(startDate.getMonth() - 1);
    if (period === 'year') { startDate = new Date(now); startDate.setFullYear(startDate.getFullYear() - 1); }

    const revenue = await db('invoices').where('status', 'paid').where('created_at', '>=', startDate)
      .sum('total as total').first();

    httpRequestsTotal.inc({ method: 'GET', path: '/api/erp/reports/revenue', status: '200' });
    res.json({ period, total_revenue: revenue?.total || 0, currency: 'ZAR' });
  } catch (error) {
    logger.error('Error generating revenue report:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /reports/expenses
app.get('/api/erp/reports/expenses', async (req: Request, res: Response) => {
  try {
    const expenses = await db('payslips').where('status', 'paid').sum('amount as total').first();

    httpRequestsTotal.inc({ method: 'GET', path: '/api/erp/reports/expenses', status: '200' });
    res.json({ total_expenses: expenses?.total || 0, currency: 'ZAR' });
  } catch (error) {
    logger.error('Error generating expense report:', error);
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
    await getNATS();
    await db.raw('SELECT 1');
    logger.info('PostgreSQL connected');
    app.listen(config.port, () => logger.info(`ERP Service running on port ${config.port}`));
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

process.on('SIGTERM', async () => { logger.info('SIGTERM, shutting down'); await db.destroy(); if (nc) await nc.close(); process.exit(0); });
process.on('SIGINT', async () => { logger.info('SIGINT, shutting down'); await db.destroy(); if (nc) await nc.close(); process.exit(0); });

startServer();
export default app;