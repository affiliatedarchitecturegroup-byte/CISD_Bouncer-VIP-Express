// ===========================================
// Push Notifications Service
// FCM (Firebase) / APNS (Apple) integration
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
// FCM (Firebase Cloud Messaging)
// ===========================================

class FCMService {
  private apiKey: string;
  private baseUrl = 'https://fcm.googleapis.com/fcm/send';

  constructor() {
    this.apiKey = process.env.FCM_SERVER_KEY || '';
  }

  async sendToDevice(
    deviceToken: string,
    title: string,
    body: string,
    data?: Record<string, string>
  ): Promise<{ success: boolean; messageId: string }> {
    const payload = {
      to: deviceToken,
      notification: {
        title,
        body,
        sound: 'default',
      },
      data: data || {},
    };

    const response = await axios.post(this.baseUrl, payload, {
      headers: {
        'Authorization': `key=${this.apiKey}`,
        'Content-Type': 'application/json',
      },
    });

    return {
      success: response.data.success === 1,
      messageId: response.data.message_id || uuidv4(),
    };
  }

  async sendToTopic(
    topic: string,
    title: string,
    body: string,
    data?: Record<string, string>
  ): Promise<{ success: boolean }> {
    const payload = {
      to: `/topics/${topic}`,
      notification: { title, body },
      data: data || {},
    };

    await axios.post(this.baseUrl, payload, {
      headers: {
        'Authorization': `key=${this.apiKey}`,
        'Content-Type': 'application/json',
      },
    });

    return { success: true };
  }

  async sendBatch(
    tokens: string[],
    title: string,
    body: string,
    data?: Record<string, string>
  ): Promise<{ success: number; failed: number }> {
    let success = 0, failed = 0;

    for (const token of tokens) {
      try {
        const result = await this.sendToDevice(token, title, body, data);
        if (result.success) success++;
        else failed++;
      } catch {
        failed++;
      }
    }

    return { success, failed };
  }
}

// ===========================================
// APNS (Apple Push Notification Service)
// ===========================================

class APNSService {
  private keyId: string;
  private teamId: string;
  private bundleId: string;

  constructor() {
    this.keyId = process.env.APNS_KEY_ID || '';
    this.teamId = process.env.APNS_TEAM_ID || '';
    this.bundleId = process.env.APNS_BUNDLE_ID || 'com.bouncervip.app';
  }

  private async getAccessToken(): Promise<string> {
    // In production, implement JWT generation for APNS
    return 'mock_token';
  }

  async sendToDevice(
    deviceToken: string,
    title: string,
    body: string,
    data?: Record<string, string>
  ): Promise<{ success: boolean }> {
    const token = await this.getAccessToken();
    
    // Simplified - production would use apn library
    console.log(`Sending APNS to ${deviceToken}: ${title}`);
    
    return { success: true };
  }
}

// ===========================================
// Push Service
// ===========================================

class PushService {
  private fcm: FCMService;
  private apns: APNSService;

  constructor() {
    this.fcm = new FCMService();
    this.apns = new APNSService();
  }

  async sendPush(
    userId: string,
    title: string,
    body: string,
    data?: Record<string, string>,
    platform?: 'android' | 'ios' | 'all'
  ): Promise<void> {
    // Get user's device tokens
    const tokens = await this.getDeviceTokens(userId, platform);
    
    for (const token of tokens) {
      if (token.platform === 'android') {
        await this.fcm.sendToDevice(token.token, title, body, data);
      } else if (token.platform === 'ios') {
        await this.apns.sendToDevice(token.token, title, body, data);
      }
    }

    // Log notification
    await this.logNotification(userId, title, body, data);
  }

  private async getDeviceTokens(
    userId: string,
    platform?: string
  ): Promise<{ token: string; platform: string }[]> {
    let query = 'SELECT token, platform FROM device_tokens WHERE user_id = $1';
    const params: any[] = [userId];
    
    if (platform && platform !== 'all') {
      query += ' AND platform = $2';
      params.push(platform);
    }

    const result = await pool.query(query, params);
    return result.rows;
  }

  private async logNotification(
    userId: string,
    title: string,
    body: string,
    data?: Record<string, string>
  ): Promise<void> {
    await pool.query(`
      INSERT INTO push_notifications (id, user_id, title, body, data, sent_at)
      VALUES ($1, $2, $3, $4, $5, NOW())
    `, [uuidv4(), userId, title, body, JSON.stringify(data || {})]);
  }
}

const pushService = new PushService();

// ===========================================
// Notification Templates
// ===========================================

const NOTIFICATION_TEMPLATES = {
  shift_reminder: {
    title: 'Shift Reminder',
    body: 'Your shift at {{venue}} starts in {{time}}',
  },
  booking_confirmed: {
    title: 'Booking Confirmed',
    body: 'Your booking for {{venue}} has been confirmed',
  },
  incident_reported: {
    title: 'Incident Reported',
    body: 'A {{type}} incident has been reported at {{venue}}',
  },
  invoice_received: {
    title: 'New Invoice',
    body: 'Invoice #{{invoiceNumber}} - R{{amount}}',
  },
  emergency_alert: {
    title: '⚠️ Emergency Alert',
    body: '{{message}}',
  },
};

async function sendTemplatedNotification(
  userId: string,
  template: string,
  variables: Record<string, string>
): Promise<void> {
  const tmpl = NOTIFICATION_TEMPLATES[template as keyof typeof NOTIFICATION_TEMPLATES];
  if (!tmpl) throw new Error(`Template ${template} not found`);

  let title = tmpl.title;
  let body = tmpl.body;

  for (const [key, value] of Object.entries(variables)) {
    title = title.replace(new RegExp(`{{${key}}}`, 'g'), value);
    body = body.replace(new RegExp(`{{${key}}}`, 'g'), value);
  }

  await pushService.sendPush(userId, title, body, { template, ...variables });
}

// ===========================================
// Device Registration
// ===========================================

app.post('/api/devices/register', async (req: Request, res: Response) => {
  try {
    const { userId, token, platform } = req.body;
    
    await pool.query(`
      INSERT INTO device_tokens (id, user_id, token, platform, created_at)
      VALUES ($1, $2, $3, $4, NOW())
      ON CONFLICT (user_id, token) DO UPDATE SET last_active = NOW()
    `, [uuidv4(), userId, token, platform]);
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to register device' });
  }
});

app.post('/api/devices/unregister', async (req: Request, res: Response) => {
  try {
    const { token } = req.body;
    await pool.query('DELETE FROM device_tokens WHERE token = $1', [token]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to unregister device' });
  }
});

// ===========================================
// Send Notifications
// ===========================================

app.post('/api/notify', async (req: Request, res: Response) => {
  try {
    const { userId, title, body, data, platform } = req.body;
    await pushService.sendPush(userId, title, body, data, platform);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to send notification' });
  }
});

app.post('/api/notify/template', async (req: Request, res: Response) => {
  try {
    const { userId, template, variables, platform } = req.body;
    await sendTemplatedNotification(userId, template, variables);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

app.post('/api/notify/topic', async (req: Request, res: Response) => {
  try {
    const { topic, title, body, data } = req.body;
    const fcm = new FCMService();
    await fcm.sendToTopic(topic, title, body, data);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to send topic notification' });
  }
});

// ===========================================
// Preferences
// ===========================================

app.get('/api/preferences/:userId', async (req: Request, res: Response) => {
  try {
    const prefs = await pool.query(
      'SELECT * FROM notification_preferences WHERE user_id = $1',
      [req.params.userId]
    );
    res.json({ success: true, data: prefs.rows[0] || {} });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch preferences' });
  }
});

app.put('/api/preferences/:userId', async (req: Request, res: Response) => {
  try {
    const { shiftReminders, bookingAlerts, incidents, invoices, marketing } = req.body;
    
    await pool.query(`
      INSERT INTO notification_preferences (user_id, shift_reminders, booking_alerts, incidents, invoices, marketing)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (user_id) DO UPDATE SET
        shift_reminders = $2,
        booking_alerts = $3,
        incidents = $4,
        invoices = $5,
        marketing = $6
    `, [req.params.userId, shiftReminders, bookingAlerts, incidents, invoices, marketing]);
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to update preferences' });
  }
});

// ===========================================
// Analytics
// ===========================================

app.get('/api/analytics', async (req: Request, res: Response) => {
  try {
    const [total, byPlatform, recent] = await Promise.all([
      pool.query('SELECT COUNT(*) as count FROM push_notifications'),
      pool.query('SELECT platform, COUNT(*) as count FROM device_tokens GROUP BY platform'),
      pool.query('SELECT * FROM push_notifications ORDER BY sent_at DESC LIMIT 10'),
    ]);
    
    res.json({
      success: true,
      data: {
        total_sent: parseInt(total.rows[0]?.count || '0'),
        by_platform: byPlatform.rows,
        recent: recent.rows,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch analytics' });
  }
});

app.get('/health', async (req: Request, res: Response) => {
  res.json({ status: 'healthy', service: 'push-notifications' });
});

const PORT = process.env.PORT || 3043;

app.listen(PORT, () => console.log(`Push Notifications Service on port ${PORT}`));

export default app;