// ===========================================
// Voice AI Service
// Speech-to-text, NLP, dispatch automation
// ===========================================

import express, { Request, Response } from 'express';
import { Pool } from 'pg';
import Redis from 'ioredis';
import { v4 as uuidv4 } from 'uuid';

const app = express();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const redis = new Redis(process.env.REDIS_URL);

app.use(express.json());

// ===========================================
// Types
// ===========================================

type TranscriptStatus = 'processing' | 'completed' | 'failed';

interface Transcript {
  id: string;
  audio_url: string;
  text: string;
  confidence: number;
  duration: number;
  language: string;
  status: TranscriptStatus;
  entities: Entity[];
  created_at: string;
}

interface Entity {
  type: 'person' | 'location' | 'time' | 'action' | 'incident';
  value: string;
  confidence: number;
}

interface Command {
  id: string;
  transcript_id: string;
  intent: string;
  entities: Record<string, any>;
  confidence: number;
  action_taken: boolean;
}

// ===========================================
// Speech-to-Text
// ===========================================

async function transcribeAudio(audioUrl: string, language: string = 'en-ZA'): Promise<Transcript> {
  const id = uuidv4();
  
  // In production, use AWS Transcribe, Google Speech, or Whisper
  // Simulated transcription
  const transcript = {
    id,
    audio_url: audioUrl,
    text: "There's a suspicious person at the main entrance. Requesting backup.",
    confidence: 0.92,
    duration: 15.5,
    language,
    status: 'completed' as TranscriptStatus,
    entities: extractEntities("There's a suspicious person at the main entrance. Requesting backup."),
    created_at: new Date().toISOString(),
  };
  
  // Store transcript
  await pool.query(`
    INSERT INTO transcripts (id, audio_url, text, confidence, duration, language, status, entities)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
  `, [id, audioUrl, transcript.text, transcript.confidence, transcript.duration, language, transcript.status, JSON.stringify(transcript.entities)]);
  
  return transcript;
}

// ===========================================
// Entity Extraction
// ===========================================

function extractEntities(text: string): Entity[] {
  const entities: Entity[] = [];
  
  // Location patterns
  const locationPatterns = [
    { regex: /main entrance/i, value: 'main entrance' },
    { regex: /back door/i, value: 'back door' },
    { regex: /parking lot/i, value: 'parking lot' },
    { regex: /VIP area/i, value: 'VIP area' },
  ];
  
  for (const pattern of locationPatterns) {
    if (pattern.regex.test(text)) {
      entities.push({ type: 'location', value: pattern.value, confidence: 0.85 });
    }
  }
  
  // Person patterns
  if (/suspicious person/i.test(text)) {
    entities.push({ type: 'person', value: 'suspicious person', confidence: 0.9 });
  }
  if (/unknown person/i.test(text)) {
    entities.push({ type: 'person', value: 'unknown person', confidence: 0.9 });
  }
  
  // Action patterns
  const actionPatterns = [
    { regex: /requesting backup/i, value: 'request_backup' },
    { regex: /need help/i, value: 'need_help' },
    { regex: /emergency/i, value: 'emergency' },
    { regex: /code red/i, value: 'code_red' },
  ];
  
  for (const pattern of actionPatterns) {
    if (pattern.regex.test(text)) {
      entities.push({ type: 'action', value: pattern.value, confidence: 0.95 });
    }
  }
  
  // Time patterns
  if (/now/i.test(text)) {
    entities.push({ type: 'time', value: 'now', confidence: 1.0 });
  }
  if (/asap/i.test(text)) {
    entities.push({ type: 'time', value: 'immediately', confidence: 1.0 });
  }
  
  // Incident type
  const incidentPatterns = [
    { regex: /theft/i, value: 'theft' },
    { regex: /assault/i, value: 'assault' },
    { regex: /trespassing/i, value: 'trespassing' },
    { regex: /fight/i, value: 'assault' },
  ];
  
  for (const pattern of incidentPatterns) {
    if (pattern.regex.test(text)) {
      entities.push({ type: 'incident', value: pattern.value, confidence: 0.85 });
    }
  }
  
  return entities;
}

// ===========================================
// Intent Classification
// ===========================================

const INTENTS = {
  emergency: {
    patterns: [/emergency/i, /help/i, /urgent/i, /code/i],
    action: 'dispatch_emergency',
  },
  backup: {
    patterns: [/backup/i, /reinforcement/i, /more officers/i],
    action: 'request_backup',
  },
  incident: {
    patterns: [/incident/i, /report/i, /suspicious/i],
    action: 'log_incident',
  },
  status: {
    patterns: [/status/i, /check/i, /everything ok/i],
    action: 'check_status',
  },
  clear: {
    patterns: [/all clear/i, /secure/i, /safe/i],
    action: 'mark_clear',
  },
};

function classifyIntent(text: string): { intent: string; confidence: number; action: string } | null {
  let bestIntent = null;
  let bestConfidence = 0;
  
  for (const [intentName, intent] of Object.entries(INTENTS)) {
    for (const pattern of intent.patterns) {
      if (pattern.test(text)) {
        const confidence = pattern.test(text) ? 0.9 : 0.5;
        if (confidence > bestConfidence) {
          bestConfidence = confidence;
          bestIntent = { intent: intentName, confidence, action: intent.action };
        }
      }
    }
  }
  
  return bestIntent;
}

// ===========================================
// Command Processing
// ===========================================

async function processCommand(transcriptId: string, text: string): Promise<Command> {
  const intent = classifyIntent(text);
  
  if (!intent) {
    return {
      id: uuidv4(),
      transcript_id: transcriptId,
      intent: 'unknown',
      entities: {},
      confidence: 0,
      action_taken: false,
    };
  }
  
  const entities = extractEntities(text);
  const entityMap: Record<string, any> = {};
  for (const entity of entities) {
    entityMap[entity.type] = entity.value;
  }
  
  const command: Command = {
    id: uuidv4(),
    transcript_id: transcriptId,
    intent: intent.intent,
    entities: entityMap,
    confidence: intent.confidence,
    action_taken: false,
  };
  
  // Execute action
  await executeCommand(command);
  command.action_taken = true;
  
  // Store command
  await pool.query(`
    INSERT INTO voice_commands (id, transcript_id, intent, entities, confidence, action_taken)
    VALUES ($1, $2, $3, $4, $5, $6)
  `, [command.id, transcriptId, intent.intent, JSON.stringify(entityMap), intent.confidence, true]);
  
  return command;
}

async function executeCommand(command: Command): Promise<void> {
  const { intent, entities } = command;
  
  switch (intent) {
    case 'emergency':
      await dispatchEmergency(entities);
      break;
    case 'backup':
      await requestBackup(entities);
      break;
    case 'incident':
      await logIncident(entities);
      break;
    case 'status':
      await checkStatus(entities);
      break;
    case 'clear':
      await markClear(entities);
      break;
  }
}

// ===========================================
// Dispatch Actions
// ===========================================

async function dispatchEmergency(entities: Record<string, any>): Promise<void> {
  const location = entities.location || 'unknown';
  const incidentType = entities.incident || 'emergency';
  
  // Create incident
  await pool.query(`
    INSERT INTO incidents (id, title, description, incident_type, severity, status, created_at)
    VALUES ($1, $2, $3, $4, 'critical', 'open', NOW())
  `, [uuidv4(), `Emergency: ${incidentType}`, `Voice dispatch emergency at ${location}`, incidentType]);
  
  // Notify dispatch
  await redis.lpush('dispatch:emergency', JSON.stringify({
    type: incidentType,
    location,
    priority: 'critical',
    timestamp: Date.now(),
  }));
}

async function requestBackup(entities: Record<string, any>): Promise<void> {
  const location = entities.location || 'unknown';
  
  await redis.lpush('dispatch:backup', JSON.stringify({
    location,
    officers_needed: 2,
    timestamp: Date.now(),
  }));
}

async function logIncident(entities: Record<string, any>): Promise<void> {
  const location = entities.location || 'unknown';
  
  await pool.query(`
    INSERT INTO incidents (id, title, description, incident_type, severity, status, created_at)
    VALUES ($1, $2, $3, $4, 'medium', 'open', NOW())
  `, [uuidv4(), 'Voice-reported incident', `Incident reported via voice at ${location}`, 'other']);
}

async function checkStatus(entities: Record<string, any>): Promise<void> {
  // Send status update
  console.log('Status check requested');
}

async function markClear(entities: Record<string, any>): Promise<void> {
  // Mark area as clear
  console.log('Area marked as clear');
}

// ===========================================
// NLP Features
// ===========================================

function analyzeSentiment(text: string): { score: number; label: 'positive' | 'negative' | 'neutral' } {
  const positiveWords = ['good', 'clear', 'safe', 'ok', 'fine', 'secure'];
  const negativeWords = ['bad', 'danger', 'suspicious', 'emergency', 'help', 'trouble'];
  
  let score = 0;
  
  const words = text.toLowerCase().split(/\s+/);
  for (const word of words) {
    if (positiveWords.includes(word)) score += 0.2;
    if (negativeWords.includes(word)) score -= 0.2;
  }
  
  score = Math.max(-1, Math.min(1, score));
  
  return {
    score,
    label: score > 0.1 ? 'positive' : score < -0.1 ? 'negative' : 'neutral',
  };
}

function extractKeywords(text: string): string[] {
  const stopWords = ['the', 'a', 'an', 'is', 'are', 'at', 'in', 'on', 'to', 'for', 'of', 'and', 'or', 'but'];
  const words = text.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/);
  return words.filter(w => w.length > 3 && !stopWords.includes(w));
}

// ===========================================
// API Routes
// ===========================================

app.post('/api/transcribe', async (req: Request, res: Response) => {
  try {
    const { audio_url, language } = req.body;
    const transcript = await transcribeAudio(audio_url, language);
    res.json({ success: true, data: transcript });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Transcription failed' });
  }
});

app.get('/api/transcripts', async (req: Request, res: Response) => {
  try {
    const { limit } = req.query;
    const result = await pool.query(`
      SELECT * FROM transcripts ORDER BY created_at DESC LIMIT $1
    `, [limit || 50]);
    res.json({ success: true, data: result.rows });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch transcripts' });
  }
});

app.post('/api/commands', async (req: Request, res: Response) => {
  try {
    const { transcript_id, text } = req.body;
    const command = await processCommand(transcript_id, text);
    res.json({ success: true, data: command });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Command processing failed' });
  }
});

app.get('/api/commands', async (req: Request, res: Response) => {
  try {
    const result = await pool.query(`
      SELECT * FROM voice_commands ORDER BY created_at DESC LIMIT 100
    `);
    res.json({ success: true, data: result.rows });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch commands' });
  }
});

app.get('/api/analyze/:text', async (req: Request, res: Response) => {
  try {
    const text = decodeURIComponent(req.params.text);
    const entities = extractEntities(text);
    const intent = classifyIntent(text);
    const sentiment = analyzeSentiment(text);
    const keywords = extractKeywords(text);
    
    res.json({
      success: true,
      data: { entities, intent, sentiment, keywords },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Analysis failed' });
  }
});

app.get('/health', async (req: Request, res: Response) => {
  res.json({ status: 'healthy', service: 'voice-ai' });
});

const PORT = process.env.PORT || 3061;

app.listen(PORT, () => console.log(`Voice AI Service on port ${PORT}`));

export default app;