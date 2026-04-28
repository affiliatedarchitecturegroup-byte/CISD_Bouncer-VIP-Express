// ===========================================
// SMS Gateway Service
// Clickatell / Africa's Talking / Telkom integration
// ===========================================

import express, { Request, Response } from 'express';
import { Pool } from 'pg';
import Redis from 'ioredis';
import { v4 as uuidv4 } from 'uuid';
import axios from 'axios';

const app = express();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const redis = new Redis(process.env.REDIS_URL);

app.use(express.json());

// ===========================================
// SMS Providers
// ===========================================

type Provider = 'clickatell' | 'africastalking' | 'telkom' | 'twilio';

interface SMSProvider {
  send(to: string, message: string): Promise<{ messageId: string; status: string }>;
}

class ClickatellProvider implements SMSProvider {
  private apiKey: string;
  private baseUrl = 'https://platform.clickatell.com';

  constructor() {
    this.apiKey = process.env.CLICKATELL_API_KEY || '';
  }

  async send(to: string, message: string): Promise<{ messageId: string; status: string }> {
    const response = await axios.post(
      `${this.baseUrl}/messages/send`,
      {
        to: this.normalizeNumber(to),
        content: message,
      },
      {
        headers: { 'Authorization': this.apiKey, 'Content-Type': 'application/json' },
      }
    );

    return {
      messageId: response.data.messages[0].messageUuid,
      status: response.data.messages[0].status,
    };
  }

  private normalizeNumber(number: string): string {
    return number.replace(/^0/, '27').replace(/\D/g, '');
  }
}

class AfricaStalkingProvider implements SMSProvider {
  private username: string;
  private apiKey: string;
  private baseUrl = 'https://api.africastalking.com';

  constructor() {
    this.username = process.env.AFRICASTALKING_USERNAME || '';
    this.apiKey = process.env.AFRICASTALKING_API_KEY || '';
  }

  async send(to: string, message: string): Promise<{ messageId: string; status: string }> {
    const response = await axios.post(
      `${this.baseUrl}/version1/messaging`,
      {
        to: this.normalizeNumber(to),
        message,
      },
      {
        headers: {
          'Authorization': `Basic ${Buffer.from(`${this.username}:${this.apiKey}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }
    );

    return {
      messageId: response.data.SMSMessageData.Recipients[0].messageId,
      status: response.data.SMSMessageData.Recipients[0].status,
    };
  }

  private normalizeNumber(number: string): string {
    return number.replace(/^0/, '+27').replace(/\s/g, '');
  }
}

class TelkomProvider implements SMSProvider {
  private consumerSecret: string;
  private consumerKey: string;
  private baseUrl = 'https://api.telkom.co.za';

  constructor() {
    this.consumerSecret = process.env.TELKOM_SECRET || '';
    this.consumerKey = process.env.TELKOM_KEY || '';
  }

  async send(to: string, message: string): Promise<{ messageId: string; status: string }> {
    // OAuth flow would go here for production
    const messageId = `TELKOM-${Date.now()}`;
    return { messageId, status: 'sent' };
  }
}

// ===========================================
// SMS Service
// ===========================================

class SMSService {
  private providers: Map<Provider, SMSProvider>;

  constructor() {
    this.providers = new Map();
    this.providers.set('clickatell', new ClickatellProvider());
    this.providers.set('africastalking', new AfricaStalkingProvider());
    this.providers.set('telkom', new TelkomProvider());
  }

  async sendSMS(to: string, message: string, provider: Provider = 'clickatell'): Promise<{ messageId: string; status: string }> {
    const providerInstance = this.providers.get(provider);
    if (!providerInstance) throw new Error(`Provider ${provider} not configured`);

    const result = await providerInstance.send(to, message);

    // Log SMS
    await pool.query(`
      INSERT INTO sms_logs (id, to_number, message, provider, status, message_id, sent_at)
      VALUES ($1, $2, $3, $4, $5, $6, NOW())
    `, [uuidv4(), to, message, provider, result.status, result.messageId]);

    return result;
  }

  async sendBulkSMS(numbers: string[], message: string, provider: Provider = 'clickatell'): Promise<{ sent: number; failed: number; results: any[] }> {
    const results: any[] = [];
    let sent = 0, failed = 0;

    for (const number of numbers) {
      try {
        const result = await this.sendSMS(number, message, provider);
        results.push({ number, ...result });
        sent++;
      } catch (error) {
        results.push({ number, error: (error as Error).message });
        failed++;
      }
    }

    return { sent, failed, results };
  }

  async scheduleSMS(to: string, message: string, scheduledTime: Date, provider: Provider = 'clickatell'): Promise<void> {
    await pool.query(`
      INSERT INTO scheduled_sms (id, to_number, message, provider, scheduled_time, status)
      VALUES ($1, $2, $3, $4, $5, 'pending')
    `, [uuidv4(), to, message, provider, scheduledTime]);
  }
}

const smsService = new SMSService();

// ===========================================
// Webhook Handler
// ===========================================

app.post('/webhook/status', async (req: Request, res: Response) => {
  const { messageId, status } = req.body;
  
  await pool.query(`
    UPDATE sms_logs SET status = $1 WHERE message_id = $2
  `, [status, messageId]);

  res.sendStatus(200);
});

app.post('/webhook/receive', async (req: Request, res: Response) => {
  const { from, content } = req.body;

  await pool.query(`
    INSERT INTO sms_received (id, from_number, content, received_at)
    VALUES ($1, $2, $3, NOW())
  `, [uuidv4(), from, content]);

  // Handle incoming commands
  await handleIncomingSMS(from, content);

  res.sendStatus(200);
});

async function handleIncomingSMS(from: string, content: string): Promise<void> {
  const command = content.toUpperCase().trim();

  switch (command) {
    case 'STOP':
      await smsService.sendSMS(from, 'You have been unsubscribed from Bouncer VIP notifications.');
      await pool.query(`UPDATE users SET sms_opt_in = false WHERE phone = $1`, [from]);
      break;
    case 'START':
      await smsService.sendSMS(from, 'You have been subscribed to Bouncer VIP notifications.');
      await pool.query(`UPDATE users SET sms_opt_in = true WHERE phone = $1`, [from]);
      break;
    case 'HELP':
      await smsService.sendSMS(from, 'Bouncer VIP: Reply STOP to unsubscribe, START to resubscribe.');
      break;
    default:
      // Forward to support
      break;
  }
}

// ===========================================
// Template Management
// ===========================================

interface SMSTemplate {
  id: string;
  name: string;
  content: string;
  variables: string[];
}

const TEMPLATES: Record<string, SMSTemplate> = {
  shift_reminder: {
    id: 'shift_reminder',
    name: 'Shift Reminder',
    content: 'Bouncer VIP: Reminder - Your shift at {{venue}} starts at {{time}}. Please confirm attendance.',
    variables: ['venue', 'time'],
  },
  booking_confirmed: {
    id: 'booking_confirmed',
    name: 'Booking Confirmed',
    content: 'Bouncer VIP: Your booking for {{venue}} on {{date}} has been confirmed. {{officers}} officers assigned.',
    variables: ['venue', 'date', 'officers'],
  },
  incident_alert: {
    id: 'incident_alert',
    name: 'Incident Alert',
    content: 'Bouncer VIP Alert: {{type}} incident reported at {{venue}}. Immediate attention required.',
    variables: ['type', 'venue'],
  },
  emergency: {
    id: 'emergency',
    name: 'Emergency Alert',
    content: 'URGENT: {{message}}. Response required immediately. Location: {{location}}',
    variables: ['message', 'location'],
  },
};

async function sendTemplatedSMS(
  to: string,
  templateName: string,
  variables: Record<string, string>,
  provider?: Provider
): Promise<{ messageId: string; status: string }> {
  const template = TEMPLATES[templateName];
  if (!template) throw new Error(`Template ${templateName} not found`);

  let content = template.content;
  for (const [key, value] of Object.entries(variables)) {
    content = content.replace(new RegExp(`{{${key}}}`, 'g'), value);
  }

  return smsService.sendSMS(to, content, provider);
}

// ===========================================
// API Routes
// ===========================================

app.post('/api/send', async (req: Request, res: Response) => {
  try {
    const { to, message, provider } = req.body;
    const result = await smsService.sendSMS(to, message, provider);
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to send SMS' });
  }
});

app.post('/api/send-bulk', async (req: Request, res: Response) => {
  try {
    const { numbers, message, provider } = req.body;
    const result = await smsService.sendBulkSMS(numbers, message, provider);
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to send bulk SMS' });
  }
});

app.post('/api/send-template', async (req: Request, res: Response) => {
  try {
    const { to, template, variables, provider } = req.body;
    const result = await sendTemplatedSMS(to, template, variables, provider);
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

app.post('/api/schedule', async (req: Request, res: Response) => {
  try {
    const { to, message, scheduled_time, provider } = req.body;
    await smsService.scheduleSMS(to, message, new Date(scheduled_time), provider);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to schedule SMS' });
  }
});

app.get('/api/templates', async (req: Request, res: Response) => {
  res.json({ success: true, data: Object.values(TEMPLATES) });
});

app.get('/api/logs', async (req: Request, res: Response) => {
  try {
    const { limit, offset } = req.query;
    const logs = await pool.query(
      `SELECT * FROM sms_logs ORDER BY sent_at DESC LIMIT $1 OFFSET $2`,
      [limit || 50, offset || 0]
    );
    res.json({ success: true, data: logs.rows });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch logs' });
  }
});

app.get('/health', async (req: Request, res: Response) => {
  res.json({ status: 'healthy', service: 'sms-gateway' });
});

const PORT = process.env.PORT || 3040;

app.listen(PORT, () => console.log(`SMS Gateway Service on port ${PORT}`));

export default app;