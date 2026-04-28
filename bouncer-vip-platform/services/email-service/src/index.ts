// ===========================================
// Email Service
// SMTP with templates, sendgrid/postmark integration
// ===========================================

import express, { Request, Response } from 'express';
import { Pool } from 'pg';
import Redis from 'ioredis';
import { v4 as uuidv4 } from 'uuid';
import nodemailer from 'nodemailer';
import mg from 'mailgun.js';

const app = express();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const redis = new Redis(process.env.REDIS_URL);

app.use(express.json());

// ===========================================
// Email Transport
// ===========================================

interface EmailTransport {
  sendMail(options: any): Promise<any>;
}

class SMTPTransport implements EmailTransport {
  private transporter: any;

  constructor() {
    this.transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.mailtrap.io',
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: false,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
  }

  async sendMail(options: any) {
    return this.transporter.sendMail(options);
  }
}

class MailgunTransport implements EmailTransport {
  private mailgun: any;
  private domain: string;

  constructor() {
    this.mailgun = mg({});
    this.domain = process.env.MAILGUN_DOMAIN || '';
  }

  async sendMail(options: any) {
    return this.mailgun.messages().send({
      from: options.from,
      to: options.to,
      subject: options.subject,
      html: options.html,
      text: options.text,
    });
  }
}

class SendGridTransport implements EmailTransport {
  private apiKey: string;

  constructor() {
    this.apiKey = process.env.SENDGRID_API_KEY || '';
  }

  async sendMail(options: any) {
    const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: options.to }] }],
        from: { email: options.from },
        subject: options.subject,
        content: [
          { type: 'text/plain', value: options.text || '' },
          { type: 'text/html', value: options.html || '' },
        ],
      }),
    });
    return response;
  }
}

// ===========================================
// Email Service
// ===========================================

class EmailService {
  private transport: EmailTransport;
  private fromAddress: string;
  private fromName: string;

  constructor() {
    const provider = process.env.EMAIL_PROVIDER || 'smtp';
    
    switch (provider) {
      case 'mailgun':
        this.transport = new MailgunTransport();
        break;
      case 'sendgrid':
        this.transport = new SendGridTransport();
        break;
      default:
        this.transport = new SMTPTransport();
    }

    this.fromAddress = process.env.EMAIL_FROM_ADDRESS || 'noreply@bouncervip.com';
    this.fromName = process.env.EMAIL_FROM_NAME || 'Bouncer VIP';
  }

  async sendEmail(to: string, subject: string, html: string, text?: string): Promise<{ messageId: string }> {
    const messageId = uuidv4();

    try {
      await this.transport.sendMail({
        from: `${this.fromName} <${this.fromAddress}>`,
        to,
        subject,
        html,
        text: text || this.stripHtml(html),
      });

      await this.logEmail(to, subject, 'sent', messageId);
      return { messageId };
    } catch (error) {
      await this.logEmail(to, subject, 'failed', messageId, (error as Error).message);
      throw error;
    }
  }

  private stripHtml(html: string): string {
    return html.replace(/<[^>]*>/g, '').trim();
  }

  private async logEmail(
    to: string,
    subject: string,
    status: string,
    messageId: string,
    error?: string
  ): Promise<void> {
    await pool.query(`
      INSERT INTO email_logs (id, to_address, subject, status, message_id, error, sent_at)
      VALUES ($1, $2, $3, $4, $5, $6, NOW())
    `, [uuidv4(), to, subject, status, messageId, error]);
  }
}

const emailService = new EmailService();

// ===========================================
// Email Templates
// ===========================================

interface EmailTemplate {
  id: string;
  name: string;
  subject: string;
  html: string;
  variables: string[];
}

const TEMPLATES: Record<string, EmailTemplate> = {
  welcome: {
    id: 'welcome',
    name: 'Welcome Email',
    subject: 'Welcome to Bouncer VIP',
    html: `
      <h1>Welcome to Bouncer VIP!</h1>
      <p>Hi {{firstName}},</p>
      <p>Thank you for joining Bouncer VIP. Your account has been created successfully.</p>
      <p>Get started by:</p>
      <ul>
        <li>Completing your profile</li>
        <li>Setting up your availability</li>
        <li>Reviewing your assigned shifts</li>
      </ul>
      <p><a href="{{loginUrl}}">Login to your dashboard</a></p>
      <p>Best regards,<br>The Bouncer VIP Team</p>
    `,
    variables: ['firstName', 'loginUrl'],
  },

  shift_assigned: {
    id: 'shift_assigned',
    name: 'Shift Assigned',
    subject: 'New Shift Assigned - {{venueName}}',
    html: `
      <h1>New Shift Assigned</h1>
      <p>Hi {{officerName}},</p>
      <p>You have been assigned a new shift:</p>
      <table style="width: 100%; border-collapse: collapse;">
        <tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>Venue</strong></td><td style="padding: 8px; border: 1px solid #ddd;">{{venueName}}</td></tr>
        <tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>Date</strong></td><td style="padding: 8px; border: 1px solid #ddd;">{{date}}</td></tr>
        <tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>Time</strong></td><td style="padding: 8px; border: 1px solid #ddd;">{{time}}</td></tr>
        <tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>Rate</strong></td><td style="padding: 8px; border: 1px solid #ddd;">{{rate}}/hour</td></tr>
      </table>
      <p>Please confirm your attendance.</p>
    `,
    variables: ['officerName', 'venueName', 'date', 'time', 'rate'],
  },

  booking_confirmation: {
    id: 'booking_confirmation',
    name: 'Booking Confirmation',
    subject: 'Booking Confirmed - {{venueName}}',
    html: `
      <h1>Booking Confirmed</h1>
      <p>Dear {{clientName}},</p>
      <p>Your booking has been confirmed. Here are the details:</p>
      <table style="width: 100%; border-collapse: collapse;">
        <tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>Venue</strong></td><td style="padding: 8px; border: 1px solid #ddd;">{{venueName}}</td></tr>
        <tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>Date</strong></td><td style="padding: 8px; border: 1px solid #ddd;">{{date}}</td></tr>
        <tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>Officers</strong></td><td style="padding: 8px; border: 1px solid #ddd;">{{officerCount}}</td></tr>
        <tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>Total</strong></td><td style="padding: 8px; border: 1px solid #ddd;">{{total}}</td></tr>
      </table>
    `,
    variables: ['clientName', 'venueName', 'date', 'officerCount', 'total'],
  },

  invoice_sent: {
    id: 'invoice_sent',
    name: 'Invoice Sent',
    subject: 'Invoice {{invoiceNumber}} - Due {{dueDate}}',
    html: `
      <h1>New Invoice</h1>
      <p>Dear {{clientName}},</p>
      <p>Please find attached invoice {{invoiceNumber}}.</p>
      <h2>Invoice Details</h2>
      <table style="width: 100%; border-collapse: collapse;">
        <tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>Amount Due</strong></td><td style="padding: 8px; border: 1px solid #ddd;">{{amount}}</td></tr>
        <tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>Due Date</strong></td><td style="padding: 8px; border: 1px solid #ddd;">{{dueDate}}</td></tr>
      </table>
      <p><a href="{{paymentUrl}}" style="background: #3b82f6; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px;">Pay Now</a></p>
    `,
    variables: ['clientName', 'invoiceNumber', 'amount', 'dueDate', 'paymentUrl'],
  },

  password_reset: {
    id: 'password_reset',
    name: 'Password Reset',
    subject: 'Reset Your Password',
    html: `
      <h1>Password Reset Request</h1>
      <p>Hi {{firstName}},</p>
      <p>You requested to reset your password. Click the button below:</p>
      <p><a href="{{resetUrl}}" style="background: #3b82f6; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px;">Reset Password</a></p>
      <p>This link expires in 1 hour.</p>
      <p>If you didn't request this, please ignore this email.</p>
    `,
    variables: ['firstName', 'resetUrl'],
  },
};

async function sendTemplatedEmail(
  to: string,
  templateId: string,
  variables: Record<string, string>
): Promise<{ messageId: string }> {
  const template = TEMPLATES[templateId];
  if (!template) throw new Error(`Template ${templateId} not found`);

  let html = template.html;
  let subject = template.subject;

  for (const [key, value] of Object.entries(variables)) {
    html = html.replace(new RegExp(`{{${key}}}`, 'g'), value);
    subject = subject.replace(new RegExp(`{{${key}}}`, 'g'), value);
  }

  return emailService.sendEmail(to, subject, html);
}

// ===========================================
// Batch Emails
// ===========================================

async function sendBatchEmails(
  recipients: { email: string; template: string; variables: Record<string, string> }[]
): Promise<{ sent: number; failed: number }> {
  let sent = 0, failed = 0;

  for (const recipient of recipients) {
    try {
      await sendTemplatedEmail(recipient.email, recipient.template, recipient.variables);
      sent++;
    } catch (error) {
      failed++;
    }
  }

  return { sent, failed };
}

// ===========================================
// Queue Processing
// ===========================================

async function processEmailQueue(): Promise<void> {
  while (true) {
    const email = await redis.lpop('email:queue');
    if (!email) break;

    const { to, subject, html, template, variables } = JSON.parse(email);

    try {
      if (template) {
        await sendTemplatedEmail(to, template, variables);
      } else {
        await emailService.sendEmail(to, subject, html);
      }
    } catch (error) {
      console.error('Failed to send email:', error);
    }
  }
}

setInterval(processEmailQueue, 5000);

// ===========================================
// API Routes
// ===========================================

app.post('/api/send', async (req: Request, res: Response) => {
  try {
    const { to, subject, html, text } = req.body;
    const result = await emailService.sendEmail(to, subject, html, text);
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to send email' });
  }
});

app.post('/api/send-template', async (req: Request, res: Response) => {
  try {
    const { to, template, variables } = req.body;
    const result = await sendTemplatedEmail(to, template, variables);
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

app.post('/api/send-batch', async (req: Request, res: Response) => {
  try {
    const { recipients } = req.body;
    const result = await sendBatchEmails(recipients);
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to send batch emails' });
  }
});

app.get('/api/templates', async (req: Request, res: Response) => {
  res.json({ success: true, data: Object.values(TEMPLATES) });
});

app.get('/api/logs', async (req: Request, res: Response) => {
  try {
    const { limit } = req.query;
    const logs = await pool.query(
      `SELECT * FROM email_logs ORDER BY sent_at DESC LIMIT $1`,
      [limit || 50]
    );
    res.json({ success: true, data: logs.rows });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch logs' });
  }
});

app.get('/health', async (req: Request, res: Response) => {
  res.json({ status: 'healthy', service: 'email-service' });
});

const PORT = process.env.PORT || 3041;

app.listen(PORT, () => console.log(`Email Service on port ${PORT}`));

export default app;