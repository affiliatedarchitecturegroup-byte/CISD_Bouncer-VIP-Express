import dotenv from 'dotenv';
import express, { Express, Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import { createClient, RedisClientType } from 'redis';
import knex, { Knex } from 'knex';
import { Registry, Counter, Histogram } from 'prom-client';
import { connect, JetStreamClient, StringCodec, JSONCodec } from 'nats';
import winston from 'winston';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import nodemailer from 'nodemailer';
import Twilio from 'twilio';

dotenv.config();

const config = {
  port: parseInt(process.env.PORT || '3013', 10), nodeEnv: process.env.NODE_ENV || 'development',
  postgres: { host: process.env.POSTGRES_HOST || 'localhost', port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
    database: process.env.POSTGRES_DB || 'bouncer_express', user: process.env.POSTGRES_USER || 'bouncer', password: process.env.POSTGRES_PASSWORD || 'dev_password' },
  redis: { host: process.env.REDIS_HOST || 'localhost', port: parseInt(process.env.REDIS_PORT || '6379', 10) },
  nats: { url: `nats://${process.env.NATS_HOST || 'localhost'}:${process.env.NATS_PORT || '4222'}` },
  email: { host: process.env.SMTP_HOST, port: parseInt(process.env.SMTP_PORT || '587'), user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  sms: { accountSid: process.env.TWILIO_SID, authToken: process.env.TWILIO_TOKEN, from: process.env.TWILIO_FROM },
};

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'debug',
  format: winston.format.combine(winston.format.timestamp(), winston.format.errors({ stack: true }), winston.format.json()),
  defaultMeta: { service: 'notification-service' },
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

let emailTransporter: nodemailer.Transporter;
let twilioClient: Twilio.Twilio;

function getEmailTransporter(): nodemailer.Transporter {
  if (!emailTransporter) {
    emailTransporter = nodemailer.createTransport({ host: config.email.host, port: parseInt(config.email.port as any), secure: false,
      auth: { user: config.email.user, pass: config.email.pass } });
  }
  return emailTransporter;
}

function getTwilioClient() {
  if (!twilioClient && config.sms.accountSid) twilioClient = Twilio(config.sms.accountSid, config.sms.authToken);
  return twilioClient;
}

export const metricsRegistry = new Registry();
const httpRequestsTotal = new Counter({ name: 'http_requests_total', help: 'Total HTTP requests', labelNames: ['method', 'path', 'status'], registers: [metricsRegistry] });
const emailsSent = new Counter({ name: 'emails_sent_total', help: 'Emails sent', registers: [metricsRegistry] });
const smsSent = new Counter({ name: 'sms_sent_total', help: 'SMS sent', registers: [metricsRegistry] });
const pushSent = new Counter({ name: 'push_sent_total', help: 'Push notifications sent', registers: [metricsRegistry] });

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

// VALIDATION
const NotificationSchema = z.object({
  type: z.enum(['email', 'sms', 'push', 'all']), recipients: z.array(z.string()).min(1),
  subject: z.string().max(200).optional(), template: z.string().max(100).optional(),
  data: z.record(z.any()).optional(), priority: z.enum(['low', 'normal', 'high']).default('normal'),
});

 app.use((err: Error, req: Request, res: Response, next: NextFunction) => { logger.error('Unhandled error:', err); res.status(500).json({ error: 'Internal server error' }); });

async function sendEmail(to: string, subject: string, body: string): Promise<boolean> {
  try {
    if (!config.email.host) { logger.warn('Email not configured'); return false; }
    await getEmailTransporter().sendMail({ from: config.email.user, to, subject, text: body });
    emailsSent.inc(); return true;
  } catch (error) { logger.error('Email error:', error); return false; }
}

async function sendSMS(to: string, body: string): Promise<boolean> {
  try {
    if (!config.sms.accountSid) { logger.warn('Twilio not configured'); return false; }
    await getTwilioClient().messages.create({ body, from: config.sms.from, to });
    smsSent.inc(); return true;
  } catch (error) { logger.error('SMS error:', error); return false; }
}

async function sendPush(token: string, title: string, body: string): Promise<boolean> {
  // Push implementation - simplified
  pushSent.inc(); return true;
}

// API ROUTES
app.post('/api/notifications/send', async (req: Request, res: Response) => {
  try {
    const data = NotificationSchema.parse(req.body);
    const notificationId = uuidv4();
    const results: any[] = [];

    for (const recipient of data.recipients) {
      let success = false;
      if (data.type === 'email' || data.type === 'all') {
        success = await sendEmail(recipient, data.subject || 'Bouncer VIP Notification', data.data?.body as string || '');
      }
      if (data.type === 'sms' || data.type === 'all') {
        success = await sendSMS(recipient, data.data?.body as string || '');
      }
      if (data.type === 'push') {
        success = await sendPush(recipient, data.subject || 'Bouncer VIP', data.data?.body as string || '');
      }
      results.push({ recipient, success });
    }

    await db('notifications').insert({ id: notificationId, type: data.type, recipients: data.recipients,
      subject: data.subject, template: data.template, status: 'sent', created_at: new Date() });

    httpRequestsTotal.inc({ method: 'POST', path: '/api/notifications/send', status: '200' });
    res.json({ notification_id: notificationId, results });
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: 'Validation error', details: error.errors });
    logger.error('Send error:', error); res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/notifications/history', async (req: Request, res: Response) => {
  try {
    const { type, limit } = req.query;
    let query = db('notifications').orderBy('created_at', 'desc').limit(parseInt(limit as string) || 50);
    if (type) query = query.where('type', type as string);
    const history = await query;
    httpRequestsTotal.inc({ method: 'GET', path: '/api/notifications/history', status: '200' });
    res.json(history);
  } catch (error) { logger.error('History error:', error); res.status(500).json({ error: 'Internal server error' }); }
});

// NATS event handlers for automated notifications
async function subscribeToEvents() {
  const nats = await getNATS();
  const jsm = await nats.jetstreamManager();
  await jsm.streams.add({ name: 'notifications', subjects: ['shifts.*', 'incidents.*', 'deployments.*'] });

  const js = nats.jetstream();
  const c = await js.consumers.get('notifications');
  const subm = await c.fetch();
  (async () => {
    for await (const m of subm) {
      const event = jsonCodec.decode(m.data);
      if (event.type === 'SHIFT_STARTING') {
        const officer = await db('security_officers').where('id', event.officer_id).first();
        if (officer?.phone) await sendSMS(officer.phone, `Shift starting soon at ${event.venue_name}`);
      }
      if (event.type === 'INCIDENT_CREATED') {
        const admins = await db('users').where('role', 'admin').select('email');
        for (const admin of admins) {
          if (admin.email) await sendEmail(admin.email, `New Incident: ${event.title}`, event.description);
        }
      }
      m.ack();
    }
  })();
  logger.info('Subscribed to NATS events');
}

app.use((err: Error, req: Request, res: Response, next: NextFunction) => { logger.error('Unhandled error:', err); res.status(500).json({ error: 'Internal server error' }); });

async function startServer() {
  try {
    await getRedis();
    await getNATS();
    await db.raw('SELECT 1');
    logger.info('PostgreSQL connected');
    subscribeToEvents().catch((e) => logger.error('NATS subscription error:', e));
    app.listen(config.port, () => logger.info(`Notification Service running on port ${config.port}`));
  } catch (error) { logger.error('Failed to start server:', error); process.exit(1); }
}

process.on('SIGTERM', async () => { logger.info('SIGTERM, shutting down'); await db.destroy(); if (redisClient) await redisClient.quit(); if (nc) await nc.close(); process.exit(0); });
process.on('SIGINT', async () => { logger.info('SIGINT, shutting down'); await db.destroy(); if (redisClient) await redisClient.quit(); if (nc) await nc.close(); process.exit(0); });

startServer();
export default app;