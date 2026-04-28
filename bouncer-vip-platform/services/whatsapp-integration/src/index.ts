// ===========================================
// WhatsApp Integration Service
// Meta Cloud API for WhatsApp Business
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
// Configuration
// ===========================================

const WHATSAPP_CONFIG = {
  phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID,
  businessAccountId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID,
  accessToken: process.env.WHATSAPP_ACCESS_TOKEN,
  apiUrl: 'https://graph.facebook.com/v18.0',
};

const MESSAGE_TEMPLATES = {
  booking_confirmation: {
    name: 'booking_confirmation',
    language: 'en_US',
    components: [
      {
        type: 'body',
        parameters: [
          { type: 'text', parameter_name: 'venue_name' },
          { type: 'text', parameter_name: 'date' },
          { type: 'text', parameter_name: 'officers' },
        ],
      },
    ],
  },
  shift_reminder: {
    name: 'shift_reminder',
    language: 'en_US',
    components: [
      {
        type: 'body',
        parameters: [
          { type: 'text', parameter_name: 'venue_name' },
          { type: 'text', parameter_name: 'time' },
        ],
      },
    ],
  },
  incident_alert: {
    name: 'incident_alert',
    language: 'en_US',
    components: [
      {
        type: 'body',
        parameters: [
          { type: 'text', parameter_name: 'incident_type' },
          { type: 'text', parameter_name: 'location' },
        ],
      },
    ],
  },
  invoice_reminder: {
    name: 'invoice_reminder',
    language: 'en_US',
    components: [
      {
        type: 'body',
        parameters: [
          { type: 'text', parameter_name: 'amount' },
          { type: 'text', parameter_name: 'due_date' },
        ],
      },
    ],
  },
};

// ===========================================
// WhatsApp API
// ===========================================

async function sendTemplateMessage(to: string, templateName: string, params: Record<string, string>): Promise<{
  messaging_product: string;
  to: string;
  type: string;
  template: any;
}> {
  const template = MESSAGE_TEMPLATES[templateName as keyof typeof MESSAGE_TEMPLATES];
  if (!template) throw new Error('Invalid template');
  
  // Replace parameters
  const components = template.components.map(comp => {
    if (comp.type === 'body') {
      return {
        ...comp,
        parameters: comp.parameters.map(p => ({
          ...p,
          text: params[p.parameter_name] || '',
        })),
      };
    }
    return comp;
  });
  
  const payload = {
    messaging_product: 'whatsapp',
    to,
    type: 'template',
    template: {
      name: template.name,
      language: { code: template.language },
      components,
    },
  };
  
  try {
    const response = await axios.post(
      `${WHATSAPP_CONFIG.apiUrl}/${WHATSAPP_CONFIG.phoneNumberId}/messages`,
      payload,
      {
        headers: {
          'Authorization': `Bearer ${WHATSAPP_CONFIG.accessToken}`,
          'Content-Type': 'application/json',
        },
      }
    );
    
    // Log message
    await logWhatsAppMessage(to, templateName, params, 'sent', response.data.messages?.[0]?.id);
    
    return response.data;
  } catch (error: any) {
    await logWhatsAppMessage(to, templateName, params, 'failed', error.message);
    throw error;
  }
}

async function sendTextMessage(to: string, message: string): Promise<void> {
  const payload = {
    messaging_product: 'whatsapp',
    to,
    type: 'text',
    text: { body: message },
  };
  
  await axios.post(
    `${WHATSAPP_CONFIG.apiUrl}/${WHATSAPP_CONFIG.phoneNumberId}/messages`,
    payload,
    {
      headers: {
        'Authorization': `Bearer ${WHATSAPP_CONFIG.accessToken}`,
        'Content-Type': 'application/json',
      },
    }
  );
}

// ===========================================
// Webhook Handling
// ===========================================

app.post('/api/webhook', async (req: Request, res: Response) => {
  const { entry } = req.body;
  
  // Verify webhook
  if (req.query['hub.mode'] === 'subscribe') {
    const challenge = req.query['hub.challenge'];
    return res.status(200).send(challenge);
  }
  
  // Process messages
  for (const e of entry || []) {
    for (const change of e.changes || []) {
      const messages = change.value?.messages || [];
      for (const msg of messages) {
        await processIncomingMessage(msg);
      }
    }
  }
  
  res.status(200).send('OK');
});

async function processIncomingMessage(message: any): Promise<void> {
  const from = message.from;
  const type = message.type;
  const text = message.text?.body;
  
  // Find user by phone number
  const user = await pool.query('SELECT id FROM users WHERE phone = $1 OR CONCAT(phone, $1) LIKE $1', [from]);
  
  if (!user.rows[0]) {
    // New user - send welcome
    await sendTextMessage(from, 'Welcome to Bouncer VIP! Your account will be created shortly. You will receive updates about your security services here.');
    return;
  }
  
  // Store message
  await pool.query(`
    INSERT INTO whatsapp_messages (id, user_id, direction, type, content, message_id)
    VALUES ($1, $2, 'incoming', $3, $4, $5)
  `, [uuidv4(), user.rows[0].id, type, text, message.id]);
  
  // Handle commands
  if (text?.toLowerCase() === 'status') {
    await sendTextMessage(from, `Your account: Active\nBookings: 3\nPending Invoices: R2,500`);
  } else if (text?.toLowerCase() === 'help') {
    await sendTextMessage(from, 'Commands:\nSTATUS - Account info\nBOOKINGS - Your bookings\nSTOP - Unsubscribe');
  }
}

// ===========================================
// Notification Triggers
// ===========================================

async function notifyBookingConfirmation(userId: string, booking: any): Promise<void> {
  const user = await pool.query('SELECT phone FROM users WHERE id = $1', [userId]);
  if (!user.rows[0]?.phone) return;
  
  await sendTemplateMessage(user.rows[0].phone, 'booking_confirmation', {
    venue_name: booking.venue_name,
    date: booking.requested_date,
    officers: booking.officer_count.toString(),
  });
}

async function notifyShiftReminder(userId: string, shift: any): Promise<void> {
  const user = await pool.query('SELECT phone FROM users WHERE id = $1', [userId]);
  if (!user.rows[0]?.phone) return;
  
  await sendTemplateMessage(user.rows[0].phone, 'shift_reminder', {
    venue_name: shift.venue_name,
    time: shift.start_time,
  });
}

async function notifyIncidentAlert(userId: string, incident: any): Promise<void> {
  const user = await pool.query('SELECT phone FROM users WHERE id = $1', [userId]);
  if (!user.rows[0]?.phone) return;
  
  await sendTemplateMessage(user.rows[0].phone, 'incident_alert', {
    incident_type: incident.type,
    location: incident.location,
  });
}

async function notifyInvoiceReminder(userId: string, invoice: any): Promise<void> {
  const user = await pool.query('SELECT phone FROM users WHERE id = $1', [userId]);
  if (!user.rows[0]?.phone) return;
  
  await sendTemplateMessage(user.rows[0].phone, 'invoice_reminder', {
    amount: `R${invoice.amount}`,
    due_date: invoice.due_date,
  });
}

// ===========================================
// Logging
// ===========================================

async function logWhatsAppMessage(
  recipient: string,
  template: string,
  params: Record<string, string>,
  status: string,
  messageId?: string
): Promise<void> {
  await pool.query(`
    INSERT INTO whatsapp_logs (id, recipient, template, params, status, message_id, sent_at)
    VALUES ($1, $2, $3, $4, $5, $6, NOW())
  `, [uuidv4(), recipient, template, JSON.stringify(params), status, messageId]);
}

// ===========================================
// Analytics
// ===========================================

async function getWhatsAppAnalytics(dateFrom?: string, dateTo?: string): Promise<{
  total_sent: number;
  delivered: number;
  read: number;
  failed: number;
  templates_used: Record<string, number>;
}> {
  let query = 'SELECT status, template, COUNT(*) as count FROM whatsapp_logs WHERE 1=1';
  const params: any[] = [];
  
  if (dateFrom) {
    params.push(dateFrom);
    query += ` AND sent_at >= $${params.length}`;
  }
  if (dateTo) {
    params.push(dateTo);
    query += ` AND sent_at <= $${params.length}`;
  }
  
  query += ' GROUP BY status, template';
  const result = await pool.query(query, params);
  
  let totalSent = 0, delivered = 0, read = 0, failed = 0;
  const templatesUsed: Record<string, number> = {};
  
  for (const row of result.rows) {
    totalSent += parseInt(row.count);
    if (row.status === 'delivered') delivered += parseInt(row.count);
    if (row.status === 'read') read += parseInt(row.count);
    if (row.status === 'failed') failed += parseInt(row.count);
    if (row.template) templatesUsed[row.template] = parseInt(row.count);
  }
  
  return {
    total_sent: totalSent,
    delivered,
    read,
    failed,
    templates_used: templatesUsed,
  };
}

// ===========================================
// Health Check
// ===========================================

app.get('/api/test', async (req: Request, res: Response) => {
  try {
    await axios.get(`${WHATSAPP_CONFIG.apiUrl}/me`, {
      headers: { 'Authorization': `Bearer ${WHATSAPP_CONFIG.accessToken}` },
    });
    res.json({ success: true, connected: true });
  } catch (error) {
    res.json({ success: false, connected: false, error: error.message });
  }
});

app.get('/api/notifications', async (req: Request, res: Response) => {
  try {
    const stats = await getWhatsAppAnalytics(req.query.from as string, req.query.to as string);
    res.json({ success: true, data: stats });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch analytics' });
  }
});

app.get('/health', async (req: Request, res: Response) => {
  res.json({ status: 'healthy', service: 'whatsapp-integration' });
});

const PORT = process.env.PORT || 3031;

app.listen(PORT, () => console.log(`WhatsApp Integration Service on port ${PORT}`));

export default app;