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

const config = { port: parseInt(process.env.PORT || '3010', 10), nodeEnv: process.env.NODE_ENV || 'development',
  postgres: { host: process.env.POSTGRES_HOST || 'localhost', port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
    database: process.env.POSTGRES_DB || 'bouncer_express', user: process.env.POSTGRES_USER || 'bouncer', password: process.env.POSTGRES_PASSWORD || 'dev_password' },
  nats: { url: `nats://${process.env.NATS_HOST || 'localhost'}:${process.env.NATS_PORT || '4222'}` },
};

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'debug',
  format: winston.format.combine(winston.format.timestamp(), winston.format.errors({ stack: true }), winston.format.json()),
  defaultMeta: { service: 'ai-recruitment-service' },
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
const candidatesScreened = new Counter({ name: 'candidates_screened_total', help: 'Candidates screened', registers: [metricsRegistry] });

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

// SCREENING QUESTIONS
const SCREENING_QUESTIONS = [
  { id: 'q1', text: 'Do you have a valid PSIRA registration?', required: true, keywords: ['psira', 'registration', 'valid'] },
  { id: 'q2', text: 'Are you available to work night shifts?', required: true, keywords: ['night', 'available', 'shifts'] },
  { id: 'q3', text: 'Do you have experience in venue security?', required: false, keywords: ['experience', 'venue', 'security'] },
  { id: 'q4', text: 'Can you provide two references?', required: true, keywords: ['references', 'provide'] },
];

// AI ANALYSIS (simplified - real impl would use LLM)
interface AnalysisResult { score: number; recommended: boolean; concerns: string[]; strengths: string[]; }

function analyzeResponse(answer: string, question: { keywords: string[] }): { score: number; keywordsFound: string[] } {
  const lowerAnswer = answer.toLowerCase();
  const keywordsFound = question.keywords.filter((k) => lowerAnswer.includes(k));
  const score = keywordsFound.length > 0 ? 70 + keywordsFound.length * 10 : 50;
  return { score, keywordsFound };
}

function analyzeVideoResponses(answers: string[]): AnalysisResult {
  let totalScore = 0;
  const allConcerns: string[] = [];
  const allStrengths: string[] = [];

  answers.forEach((answer, i) => {
    const result = analyzeResponse(answer, SCREENING_QUESTIONS[i]);
    totalScore += result.score;
    if (result.keywordsFound.length === 0) allConcerns.push(`No matching keywords for question ${i + 1}`);
    else allStrengths.push(`Matched keywords: ${result.keywordsFound.join(', ')}`);
  });

  const avgScore = totalScore / answers.length;
  return { score: avgScore, recommended: avgScore >= 65, concerns: allConcerns, strengths: allStrengths };
}

// API ROUTES
app.get('/api/recruitment/questions', async (req: Request, res: Response) => {
  httpRequestsTotal.inc({ method: 'GET', path: '/api/recruitment/questions', status: '200' });
  res.json(SCREENING_QUESTIONS);
});

app.post('/api/recruitment/candidates', async (req: Request, res: Response) => {
  const startTime = Date.now();
  try {
    const { first_name, last_name, email, phone, answers } = req.body;
    
    if (!first_name || !last_name || !email || !answers) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    const analysis = analyzeVideoResponses(answers);
    const id = uuidv4();

    const [candidate] = await db('recruitment_candidates').insert({
      id, first_name, last_name, email, phone,
      screening_answers: answers, ai_score: analysis.score, ai_recommended: analysis.recommended,
      ai_concerns: analysis.concerns, ai_strengths: analysis.strengths,
      status: 'screening', created_at: new Date(), updated_at: new Date(),
    }).returning('*');

    candidatesScreened.inc();
    
    const nats = await getNATS();
    await nats.jetstream().publish('recruitment.candidate.screened',
      stringCodec.encode(JSON.stringify({ type: 'CANDIDATE_SCREENED', candidate_id: id, score: analysis.score, recommended: analysis.recommended })), { msgID: uuidv4() });

    httpRequestsTotal.inc({ method: 'POST', path: '/api/recruitment/candidates', status: '201' });
    httpRequestDuration.observe({ method: 'POST', path: '/api/recruitment/candidates', status: '201' }, (Date.now() - startTime) / 1000);
    res.status(201).json({ candidate, analysis });
  } catch (error) { logger.error('Candidate error:', error); res.status(500).json({ error: 'Internal server error' }); }
});

app.get('/api/recruitment/candidates', async (req: Request, res: Response) => {
  try {
    const { status, min_score } = req.query;
    let query = db('recruitment_candidates').orderBy('created_at', 'desc');
    if (status) query = query.where('status', status as string);
    if (min_score) query = query.where('ai_score', '>=', parseInt(min_score as string));

    const candidates = await query;
    httpRequestsTotal.inc({ method: 'GET', path: '/api/recruitment/candidates', status: '200' });
    res.json(candidates);
  } catch (error) { logger.error('Fetch error:', error); res.status(500).json({ error: 'Internal server error' }); }
});

app.get('/api/recruitment/candidates/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const candidate = await db('recruitment_candidates').where('id', id).first();
    if (!candidate) return res.status(404).json({ error: 'Candidate not found' });
    httpRequestsTotal.inc({ method: 'GET', path: '/api/recruitment/candidates/:id', status: '200' });
    res.json(candidate);
  } catch (error) { logger.error('Fetch error:', error); res.status(500).json({ error: 'Internal server error' }); }
});

app.put('/api/recruitment/candidates/:id/status', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { status, notes } = req.body;
    const validStatuses = ['screening', 'interview', 'offer', 'hired', 'rejected'];
    if (!validStatuses.includes(status)) return res.status(400).json({ error: 'Invalid status' });

    const [candidate] = await db('recruitment_candidates').where('id', id).update({ status, recruitment_notes: notes, updated_at: new Date() }).returning('*');
    if (!candidate) return res.status(404).json({ error: 'Candidate not found' });

    const nats = await getNATS();
    await nats.jetstream().publish('recruitment.candidate.status',
      stringCodec.encode(JSON.stringify({ type: 'CANDIDATE_STATUS', candidate_id: id, status })), { msgID: uuidv4() });

    httpRequestsTotal.inc({ method: 'PUT', path: '/api/recruitment/candidates/:id/status', status: '200' });
    res.json(candidate);
  } catch (error) { logger.error('Status update error:', error); res.status(500).json({ error: 'Internal server error' }); }
});

app.post('/api/recruitment/candidates/:id/schedule-interview', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { interview_date, interview_type } = req.body;
    
    const [candidate] = await db('recruitment_candidates').where('id', id).update({
      status: 'interview', interview_date: new Date(interview_date), interview_type: interview_type || 'video', updated_at: new Date()
    }).returning('*');

    const nats = await getNATS();
    await nats.jetstream().publish('recruitment.interview.scheduled',
      stringCodec.encode(JSON.stringify({ type: 'INTERVIEW_SCHEDULED', candidate_id: id, date: interview_date })), { msgID: uuidv4() });

    httpRequestsTotal.inc({ method: 'POST', path: '/api/recruitment/candidates/:id/schedule-interview', status: '200' });
    res.json(candidate);
  } catch (error) { logger.error('Schedule error:', error); res.status(500).json({ error: 'Internal server error' }); }
});

app.get('/api/recruitment/stats', async (req: Request, res: Response) => {
  try {
    const [total, screening, interview, hired, rejected] = await Promise.all([
      db('recruitment_candidates').count('id as count').first(),
      db('recruitment_candidates').where('status', 'screening').count('id as count').first(),
      db('recruitment_candidates').where('status', 'interview').count('id as count').first(),
      db('recruitment_candidates').where('status', 'hired').count('id as count').first(),
      db('recruitment_candidates').where('status', 'rejected').count('id as count').first(),
    ]);

    const avgScore = await db('recruitment_candidates').avg('ai_score as avg').first();
    httpRequestsTotal.inc({ method: 'GET', path: '/api/recruitment/stats', status: '200' });
    res.json({
      total: total?.count, screening: screening?.count, interview: interview?.count, hired: hired?.count, rejected: rejected?.count,
      average_score: Math.round(avgScore?.avg || 0),
    });
  } catch (error) { logger.error('Stats error:', error); res.status(500).json({ error: 'Internal server error' }); }
});

app.use((err: Error, req: Request, res: Response, next: NextFunction) => { logger.error('Unhandled error:', err); res.status(500).json({ error: 'Internal server error' }); });

async function startServer() {
  try { await getNATS(); await db.raw('SELECT 1'); logger.info('PostgreSQL connected');
    app.listen(config.port, () => logger.info(`AI Recruitment Service running on port ${config.port}`));
  } catch (error) { logger.error('Failed to start server:', error); process.exit(1); }
}

process.on('SIGTERM', async () => { logger.info('SIGTERM, shutting down'); await db.destroy(); if (nc) await nc.close(); process.exit(0); });
process.on('SIGINT', async () => { logger.info('SIGINT, shutting down'); await db.destroy(); if (nc) await nc.close(); process.exit(0); });

startServer();
export default app;