// ===========================================
// Webhook Enhanced Service
// Phase 1.4 - Advanced webhook features
// ===========================================

import express, { Request, Response } from 'express';
import { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';

const app = express();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
app.use(express.json());

// ===========================================
// Types
// ===========================================

interface Webhook {
  id: string;
  url: string;
  events: string[];
  secret: string;
  active: boolean;
}

interface WebhookDelivery {
  id: string;
  webhook_id: string;
  event: string;
  payload: any;
  status: 'pending' | 'delivered' | 'failed';
  attempts: number;
  response_code?: number;
  response_body?: string;
  delivered_at?: string;
  created_at: string;
}

// ===========================================
// Signature Generation
// ===========================================

export function generateSignature(payload: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

export function verifySignature(payload: string, signature: string, secret: string): boolean {
  const expected = generateSignature(payload, secret);
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

// ===========================================
// Webhook Management
// ===========================================

async function registerWebhook(data: { url: string; events: string[]; secret?: string }): Promise<Webhook> {
  const id = uuidv4();
  const secret = data.secret || crypto.randomBytes(32).toString('hex');
  
  await pool.query(`
    INSERT INTO webhooks (id, url, events, secret, active)
    VALUES ($1, $2, $3, $4, true)
  `, [id, data.url, JSON.stringify(data.events), secret]);

  return { id, url: data.url, events: data.events, secret, active: true };
}

async function getWebhooks(): Promise<Webhook[]> {
  const result = await pool.query('SELECT * FROM webhooks WHERE active = true');
  return result.rows.map(r => ({
    ...r,
    events: JSON.parse(r.events),
  }));
}

async function getWebhooksForEvent(event: string): Promise<Webhook[]> {
  const result = await pool.query(`
    SELECT * FROM webhooks WHERE active = true AND $1 = ANY(events::text[])
  `, [event]);
  
  return result.rows.map(r => ({
    ...r,
    events: JSON.parse(r.events),
  }));
}

// ===========================================
// Retry Logic
// ===========================================

const RETRY_CONFIG = {
  maxAttempts: 5,
  backoff: {
    1: 1000,    // 1 second
    2: 5000,    // 5 seconds
    3: 30000,   // 30 seconds
    4: 120000,   // 2 minutes
    5: 300000,   // 5 minutes
  },
};

interface RetryQueue {
  webhook_id: string;
  event: string;
  payload: any;
  attempt: number;
  scheduled_at: number;
}

const retryQueue: RetryQueue[] = [];

async function scheduleRetry(deliveryId: string, attempt: number): Promise<void> {
  const delay = RETRY_CONFIG.backoff[attempt + 1];
  if (!delay) return;

  retryQueue.push({
    webhook_id: deliveryId,
    event: '',
    payload: {},
    attempt: attempt + 1,
    scheduled_at: Date.now() + delay,
  });
}

// ===========================================
// Delivery Processing
// ===========================================

async function processDelivery(webhook: Webhook, event: string, payload: any): Promise<{
  success: boolean;
  response_code?: number;
  response_body?: string;
}> {
  const deliveryId = uuidv4();
  const payloadString = JSON.stringify(payload);
  const signature = generateSignature(payloadString, webhook.secret);

  try {
    const response = await fetch(webhook.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Signature': signature,
        'X-Webhook-Event': event,
        'X-Webhook-Delivery': deliveryId,
      },
      body: payloadString,
    });

    const responseBody = await response.text();

    // Log delivery
    await pool.query(`
      INSERT INTO webhook_deliveries 
      (id, webhook_id, event, payload, status, response_code, response_body, delivered_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
    `, [deliveryId, webhook.id, event, payloadString, response.ok ? 'delivered' : 'failed', 
        response.status, responseBody.substring(0, 1000)]);

    return { success: response.ok, response_code: response.status, response_body: responseBody };
  } catch (error: any) {
    await pool.query(`
      INSERT INTO webhook_deliveries 
      (id, webhook_id, event, payload, status, attempts, created_at)
      VALUES ($1, $2, $3, $4, 'failed', 1, NOW())
    `, [deliveryId, webhook.id, event, payloadString]);

    return { success: false };
  }
}

// ===========================================
// Trigger Webhook
// ===========================================

async function triggerWebhook(event: string, payload: any): Promise<{
  delivered: number;
  failed: number;
}> {
  const webhooks = await getWebhooksForEvent(event);
  let delivered = 0, failed = 0;

  for (const webhook of webhooks) {
    const result = await processDelivery(webhook, event, payload);
    if (result.success) delivered++;
    else {
      failed++;
      await scheduleRetry(webhook.id, 1);
    }
  }

  return { delivered, failed };
}

// ===========================================
// Retry Processor (runs every minute)
// ===========================================

setInterval(async () => {
  const now = Date.now();
  const due = retryQueue.filter(r => r.scheduled_at <= now);
  
  for (const retry of due) {
    const delivery = await pool.query(`
      SELECT * FROM webhook_deliveries WHERE id = $1
    `, [retry.webhook_id]);
    
    if (delivery.rows[0]) {
      await processDelivery(
        { id: delivery.rows[0].webhook_id, url: '', events: [], secret: '', active: true },
        delivery.rows[0].event,
        JSON.parse(delivery.rows[0].payload)
      );
    }
  }
}, 60000);

// ===========================================
// API Routes
// ===========================================

app.post('/api/webhooks', async (req: Request, res: Response) => {
  const webhook = await registerWebhook(req.body);
  res.json({ success: true, data: webhook });
});

app.get('/api/webhooks', async (req: Request, res: Response) => {
  const webhooks = await getWebhooks();
  res.json({ success: true, data: webhooks });
});

app.post('/api/webhooks/trigger', async (req: Request, res: Response) => {
  const { event, payload } = req.body;
  const result = await triggerWebhook(event, payload);
  res.json({ success: true, data: result });
});

app.get('/api/webhooks/deliveries', async (req: Request, res: Response) => {
  const { webhook_id, status } = req.query;
  let sql = 'SELECT * FROM webhook_deliveries WHERE 1=1';
  const params: any[] = [];
  
  if (webhook_id) {
    params.push(webhook_id);
    sql += ` AND webhook_id = $${params.length}`;
  }
  if (status) {
    params.push(status);
    sql += ` AND status = $${params.length}`;
  }
  
  sql += ' ORDER BY created_at DESC LIMIT 100';
  const result = await pool.query(sql, params);
  res.json({ success: true, data: result.rows });
});

app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'healthy', service: 'webhook-enhanced' });
});

const PORT = process.env.PORT || 3088;
app.listen(PORT, () => console.log(`Webhook Enhanced Service on port ${PORT}`));

export default app;