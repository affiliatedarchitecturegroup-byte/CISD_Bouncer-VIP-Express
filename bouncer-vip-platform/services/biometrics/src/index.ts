import dotenv from 'dotenv';
import express, { Express, Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import crypto from 'crypto';
import knex, { Knex } from 'knex';
import { Registry, Counter, Histogram, Gauge } from 'prom-client';
import { connect, JetStreamClient, StringCodec } from 'nats';
import winston from 'winston';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';

dotenv.config();

interface Config { port: number; nodeEnv: string; postgres: { host: string; port: number; database: string; user: string; password: string }; nats: { url: string }; }

const config: Config = {
  port: parseInt(process.env.PORT || '3008', 10), nodeEnv: process.env.NODE_ENV || 'development',
  postgres: { host: process.env.POSTGRES_HOST || 'localhost', port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
    database: process.env.POSTGRES_DB || 'bouncer_express', user: process.env.POSTGRES_USER || 'bouncer', password: process.env.POSTGRES_PASSWORD || 'dev_password' },
  nats: { url: `nats://${process.env.NATS_HOST || 'localhost'}:${process.env.NATS_PORT || '4222'}` },
};

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'debug',
  format: winston.format.combine(winston.format.timestamp(), winston.format.errors({ stack: true }), winston.format.json()),
  defaultMeta: { service: 'biometrics-service' },
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
const verificationsGauge = new Gauge({ name: 'biometric_verifications_total', help: 'Total verifications', registers: [metricsRegistry] });

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
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

app.get('/metrics', async (req: Request, res: Response) => { res.set('Content-Type', metricsRegistry.contentType); res.send(await metricsRegistry.metrics()); });
app.get('/health', (req: Request, res: Response) => { res.json({ status: 'healthy', timestamp: new Date().toISOString() }); });

// VALIDATION
const EnrollSchema = z.object({
  officer_id: z.string().uuid(), photo_data: z.string().min(100), liveness_photo: z.string().min(100)
});

const VerifySchema = z.object({
  officer_id: z.string().uuid(), photo_data: z.string().min(100), location: z.object({ latitude: z.number(), longitude: z.number() }).optional()
});

const LivenessSchema = z.object({
  session_id: z.string().uuid(), liveness_photo: z.string().min(100)
});

// LIVENESS CHECK (simplified - real impl would use ML)
function performLivenessCheck(photo: string, sessionChallenge: any): { is_live: boolean; confidence: number; reason?: string } {
  const photoBuffer = Buffer.from(photo, 'base64');
  if (photoBuffer.length < 1000) return { is_live: false, confidence: 0.1, reason: 'Image too small' };
  
  // Simulated liveness detection
  const entropy = crypto.randomInt(0, 100);
  const isLive = entropy > 30;
  return { is_live: isLive, confidence: isLive ? 0.85 : 0.3, reason: isLive ? undefined : 'Liveness check failed' };
}

// FACE EMBEDDING (simplified - real impl uses face-api.js or AWS Rekognition)
function generateEmbedding(photo: string): string {
  const hash = crypto.createHash('sha256').update(photo.slice(0, 1000)).digest('base64');
  return hash.slice(0, 128);
}

function computeSimilarity(embedding1: string, embedding2: string): number {
  let matches = 0;
  for (let i = 0; i < Math.min(embedding1.length, embedding2.length); i++) {
    if (embedding1[i] === embedding2[i]) matches++;
  }
  return matches / Math.max(embedding1.length, embedding2.length);
}

// API ROUTES
app.post('/api/biometrics/enroll', async (req: Request, res: React_1.Response) => {
  const startTime = Date.now();
  try {
    const data = EnrollSchema.parse(req.body);
    
    // Generate face embedding from photo
    const faceEmbedding = generateEmbedding(data.photo_data);
    const livenessResult = performLivenessCheck(data.liveness_photo, null);
    
    if (!livenessResult.is_live) {
      httpRequestsTotal.inc({ method: 'POST', path: '/api/biometrics/enroll', status: '400' });
      return res.status(400).json({ error: 'Liveness check failed', details: livenessResult.reason });
    }
    
    const id = uuidv4();
    const [enrollment] = await db('biometric_enrollments').insert({
      id, officer_id: data.officer_id, face_embedding: faceEmbedding,
      liveness_score: livenessResult.confidence, is_verified: true,
      enrolled_at: new Date(), updated_at: new Date(),
    }).returning('*');
    
    const nats = await getNATS();
    await nats.jetstream().publish('biometrics.enrolled',
      stringCodec.encode(JSON.stringify({ type: 'OFFICER_ENROLLED', officer_id: data.officer_id, enrollment_id: id })), { msgID: uuidv4() });
    
    httpRequestsTotal.inc({ method: 'POST', path: '/api/biometrics/enroll', status: '201' });
    httpRequestDuration.observe({ method: 'POST', path: '/api/biometrics/enroll', status: '201' }, (Date.now() - startTime) / 1000);
    res.status(201).json({ success: true, enrollment_id: id, liveness_score: livenessResult.confidence });
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: 'Validation error', details: error.errors });
    logger.error('Enroll error:', error); res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/biometrics/verify', async (req: Request, res: Response) => {
  const startTime = Date.now();
  try {
    const data = VerifySchema.parse(req.body);
    
    const enrollment = await db('biometric_enrollments').where('officer_id', data.officer_id).where('is_verified', true).first();
    if (!enrollment) {
      httpRequestsTotal.inc({ method: 'POST', path: '/api/biometrics/verify', status: '404' });
      return res.status(404).json({ error: 'Officer not enrolled' });
    }
    
    const faceEmbedding = generateEmbedding(data.photo_data);
    const similarity = computeSimilarity(faceEmbedding, enrollment.face_embedding);
    
    const isMatch = similarity >= 0.7;
    const verificationId = uuidv4();
    
    await db('biometric_verifications').insert({
      id: verificationId, officer_id: data.officer_id, face_embedding: faceEmbedding,
      similarity_score: similarity, is_match: isMatch, location: data.location ? JSON.stringify(data.location) : null,
      verified_at: new Date(),
    });
    
    verificationsGauge.inc();
    
    const nats = await getNATS();
    await nats.jetstream().publish('biometrics.verified',
      stringCodec.encode(JSON.stringify({ officer_id: data.officer_id, verified: isMatch, confidence: similarity })), { msgID: uuidv4() });
    
    httpRequestsTotal.inc({ method: 'POST', path: '/api/biometrics/verify', status: isMatch ? '200' : '401' });
    httpRequestDuration.observe({ method: 'POST', path: '/api/biometrics/verify', status: isMatch ? '200' : '401' }, (Date.now() - startTime) / 1000);
    
    res.json({
      verified: isMatch, confidence: similarity, verification_id: verificationId,
      message: isMatch ? 'Verification successful' : 'Verification failed'
    });
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: 'Validation error', details: error.errors });
    logger.error('Verify error:', error); res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/biometrics/liveness/start', async (req: Request, res: Response) => {
  try {
    const sessionId = uuidv4();
    const challenge = { type: 'blink', timeout: 30 };
    
    const redisKey = `liveness:${sessionId}`;
    // In production, store challenge in Redis with expiry
    
    httpRequestsTotal.inc({ method: 'POST', path: '/api/biometrics/liveness/start', status: '200' });
    res.json({ session_id: sessionId, challenge, expires_in: 30 });
  } catch (error) {
    logger.error('Liveness start error:', error); res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/biometrics/liveness/verify', async (req: Request, res: Response) => {
  try {
    const data = LivenessSchema.parse(req.body);
    const { session_id, liveness_photo } = data;
    
    // In production, retrieve challenge from Redis
    const challenge = { type: 'blink' };
    const result = performLivenessCheck(liveness_photo, challenge);
    
    httpRequestsTotal.inc({ method: 'POST', path: '/api/biometrics/liveness/verify', status: result.is_live ? '200' : '400' });
    res.json({ passed: result.is_live, confidence: result.confidence, reason: result.reason });
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: 'Validation error', details: error.errors });
    logger.error('Liveness verify error:', error); res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/biometrics/enrollments', async (req: Request, res: Response) => {
  try {
    const { officer_id } = req.query;
    let query = db('biometric_enrollments').orderBy('enrolled_at', 'desc');
    if (officer_id) query = query.where('officer_id', officer_id as string);
    
    const enrollments = await query;
    httpRequestsTotal.inc({ method: 'GET', path: '/api/biometrics/enrollments', status: '200' });
    res.json(enrollments);
  } catch (error) {
    logger.error('Fetch error:', error); res.status(500).json({ error: 'Internal server error' });
  }
});

app.delete('/api/biometrics/enrollments/:officer_id', async (req: Request, res: Response) => {
  try {
    const { officer_id } = req.params;
    await db('biometric_enrollments').where('officer_id', officer_id).delete();
    httpRequestsTotal.inc({ method: 'DELETE', path: '/api/biometrics/enrollments/:officer_id', status: '204' });
    res.sendStatus(204);
  } catch (error) {
    logger.error('Delete error:', error); res.status(500).json({ error: 'Internal server error' });
  }
});

app.use((err: Error, req: Request, res: Response, next: NextFunction) => { logger.error('Unhandled error:', err); res.status(500).json({ error: 'Internal server error' }); });

async function startServer() {
  try {
    await getNATS();
    await db.raw('SELECT 1');
    logger.info('PostgreSQL connected');
    app.listen(config.port, () => logger.info(`Biometrics Service running on port ${config.port}`));
  } catch (error) { logger.error('Failed to start server:', error); process.exit(1); }
}

process.on('SIGTERM', async () => { logger.info('SIGTERM, shutting down'); await db.destroy(); if (nc) await nc.close(); process.exit(0); });
process.on('SIGINT', async () => { logger.info('SIGINT, shutting down'); await db.destroy(); if (nc) await nc.close(); process.exit(0); });

startServer();
export default app;