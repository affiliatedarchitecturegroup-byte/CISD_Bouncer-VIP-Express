import dotenv from 'dotenv';
import express, { Express, Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import knex, { Knex } from 'knex';
import { Registry, Counter, Histogram, Counter as CounterMetric } from 'prom-client';
import { connect, JetStreamClient, StringCodec } from 'nats';
import winston from 'winston';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';

dotenv.config();

interface Config { port: number; nodeEnv: string; postgres: { host: string; port: number; database: string; user: string; password: string }; nats: { url: string }; }

const config: Config = {
  port: parseInt(process.env.PORT || '3006', 10), nodeEnv: process.env.NODE_ENV || 'development',
  postgres: {
    host: process.env.POSTGRES_HOST || 'localhost', port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
    database: process.env.POSTGRES_DB || 'bouncer_express', user: process.env.POSTGRES_USER || 'bouncer', password: process.env.POSTGRES_PASSWORD || 'dev_password'
  },
  nats: { url: `nats://${process.env.NATS_HOST || 'localhost'}:${process.env.NATS_PORT || '4222'}` },
};

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'debug',
  format: winston.format.combine(winston.format.timestamp(), winston.format.errors({ stack: true }), winston.format.json()),
  defaultMeta: { service: 'workflow-service' },
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

const workflowsExecuted = new CounterMetric({ name: 'workflows_executed_total', help: 'Workflows executed', registers: [metricsRegistry] });
const actionsTriggered = new CounterMetric({ name: 'workflow_actions_triggered_total', help: 'Actions triggered', registers: [metricsRegistry] });

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

app.get('/health', (req: Request, res: Response) => { res.json({ status: 'healthy', timestamp: new Date().toISOString() }); });

// VALIDATION SCHEMAS
const WorkflowSchema = z.object({
  name: z.string().min(3).max(100), description: z.string().max(500).optional(), trigger_event: z.string().min(1),
  conditions: z.array(z.object({ field: z.string(), operator: z.enum(['eq', 'ne', 'gt', 'lt', 'contains', 'empty']), value: z.any() })),
  actions: z.array(z.object({ type: z.enum(['notify', 'create_record', 'update_record', 'webhook', 'delay']), 
    config: z.record(z.any()), delay_seconds: z.number().min(0).max(86400).optional() })),
  is_active: z.boolean().default(true),
});

const WorkflowExecutionSchema = z.object({ workflow_id: z.string().uuid(), context: z.record(z.any()) });

// HELPER FUNCTIONS
async function executeWorkflowActions(workflow: any, context: any): Promise<void> {
  for (const action of workflow.actions) {
    try {
      if (action.type === 'notify') {
        logger.info(`[${workflow.name}] Sending notification:`, action.config);
        actionsTriggered.inc();
      } else if (action.type === 'create_record') {
        const table = action.config?.table; delete action.config.table;
        if (table) { await db(table).insert({ ...action.config, created_at: new Date() }); actionsTriggered.inc(); }
      } else if (action.type === 'webhook') {
        logger.info(`[${workflow.name}] Calling webhook:`, action.config.url);
        actionsTriggered.inc();
      } else if (action.type === 'delay') {
        await new Promise((r) => setTimeout(r, (action.delay_seconds || 1) * 1000));
      }
    } catch (e) { logger.error(`Action error:`, e); }
  }
}

function evaluateConditions(conditions: any[], context: any): boolean {
  for (const cond of conditions) {
    const value = context[cond.field];
    if (cond.operator === 'eq' && value !== cond.value) return false;
    if (cond.operator === 'ne' && value === cond.value) return false;
    if (cond.operator === 'gt' && !(value > cond.value)) return false;
    if (cond.operator === 'lt' && !(value < cond.value)) return false;
    if (cond.operator === 'contains' && !String(value).includes(cond.value)) return false;
    if (cond.operator === 'empty' && value) return false;
  }
  return true;
}

// API ROUTES
app.get('/api/workflow/workflows', async (req: Request, res: Response) => {
  try {
    const { is_active } = req.query;
    let query = db('workflows').orderBy('created_at', 'desc');
    if (is_active !== undefined) query = query.where('is_active', is_active === 'true');
    const workflows = await query;
    httpRequestsTotal.inc({ method: 'GET', path: '/api/workflow/workflows', status: '200' });
    res.json(workflows);
  } catch (error) { logger.error('Error fetching workflows:', error); res.status(500).json({ error: 'Internal server error' }); }
});

app.post('/api/workflow/workflows', async (req: Request, res: Response) => {
  const startTime = Date.now();
  try {
    const data = WorkflowSchema.parse(req.body);
    const id = uuidv4();
    const [workflow] = await db('workflows').insert({ id, ...data, created_at: new Date(), updated_at: new Date() }).returning('*');
    httpRequestsTotal.inc({ method: 'POST', path: '/api/workflow/workflows', status: '201' });
    httpRequestDuration.observe({ method: 'POST', path: '/api/workflow/workflows', status: '201' }, (Date.now() - startTime) / 1000);
    res.status(201).json(workflow);
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: 'Validation error', details: error.errors });
    logger.error('Error creating workflow:', error); res.status(500).json({ error: 'Internal server error' });
  }
});

app.put('/api/workflow/workflows/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const data = WorkflowSchema.partial().parse(req.body);
    const existing = await db('workflows').where('id', id).first();
    if (!existing) return res.status(404).json({ error: 'Workflow not found' });
    const [updated] = await db('workflows').where('id', id).update({ ...data, updated_at: new Date() }).returning('*');
    httpRequestsTotal.inc({ method: 'PUT', path: '/api/workflow/workflows/:id', status: '200' });
    res.json(updated);
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: 'Validation error', details: error.errors });
    logger.error('Error updating workflow:', error); res.status(500).json({ error: 'Internal server error' });
  }
});

app.delete('/api/workflow/workflows/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await db('workflows').where('id', id).delete();
    httpRequestsTotal.inc({ method: 'DELETE', path: '/api/workflow/workflows/:id', status: '204' });
    res.sendStatus(204);
  } catch (error) { logger.error('Error deleting workflow:', error); res.status(500).json({ error: 'Internal server error' }); }
});

app.post('/api/workflow/execute', async (req: Request, res: Response) => {
  try {
    const { workflow_id, context } = WorkflowExecutionSchema.parse(req.body);
    const workflow = await db('workflows').where('id', workflow_id).first();
    if (!workflow) return res.status(404).json({ error: 'Workflow not found' });
    if (!workflow.is_active) return res.status(400).json({ error: 'Workflow is inactive' });

    if (evaluateConditions(workflow.conditions, context)) {
      await executeWorkflowActions(workflow, context);
      workflowsExecuted.inc();
      await db('workflow_executions').insert({ id: uuidv4(), workflow_id, context, executed_at: new Date() });
    }
    httpRequestsTotal.inc({ method: 'POST', path: '/api/workflow/execute', status: '200' });
    res.json({ success: true, workflow_id });
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: 'Validation error', details: error.errors });
    logger.error('Error executing workflow:', error); res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/workflow/executions', async (req: Request, res: Response) => {
  try {
    const { workflow_id, limit } = req.query;
    let query = db('workflow_executions').orderBy('executed_at', 'desc').limit(parseInt(limit as string) || 100);
    if (workflow_id) query = query.where('workflow_id', workflow_id as string);
    const executions = await query;
    httpRequestsTotal.inc({ method: 'GET', path: '/api/workflow/executions', status: '200' });
    res.json(executions);
  } catch (error) { logger.error('Error fetching executions:', error); res.status(500).json({ error: 'Internal server error' }); }
});

app.post('/api/workflow/trigger', async (req: Request, res: Response) => {
  try {
    const { event, data } = req.body;
    if (!event || !data) return res.status(400).json({ error: 'event and data required' });

    const workflows = await db('workflows').where('trigger_event', event).where('is_active', true);
    let executed = 0;

    for (const workflow of workflows) {
      if (evaluateConditions(workflow.conditions, data)) {
        await executeWorkflowActions(workflow, data);
        executed++;
        await db('workflow_executions').insert({ id: uuidv4(), workflow_id: workflow.id, context: data, executed_at: new Date() });
        workflowsExecuted.inc();
      }
    }
    httpRequestsTotal.inc({ method: 'POST', path: '/api/workflow/trigger', status: '200' });
    res.json({ triggered: executed, event });
  } catch (error) { logger.error('Error triggering workflows:', error); res.status(500).json({ error: 'Internal server error' }); }
});

app.use((err: Error, req: Request, res: Response, next: NextFunction) => { logger.error('Unhandled error:', err); res.status(500).json({ error: 'Internal server error' }); });

async function startServer() {
  try {
    await getNATS();
    await db.raw('SELECT 1');
    logger.info('PostgreSQL connected');
    app.listen(config.port, () => logger.info(`Workflow Service running on port ${config.port}`));
  } catch (error) { logger.error('Failed to start server:', error); process.exit(1); }
}

process.on('SIGTERM', async () => { logger.info('SIGTERM, shutting down'); await db.destroy(); if (nc) await nc.close(); process.exit(0); });
process.on('SIGINT', async () => { logger.info('SIGINT, shutting down'); await db.destroy(); if (nc) await nc.close(); process.exit(0); });

startServer();
export default app;