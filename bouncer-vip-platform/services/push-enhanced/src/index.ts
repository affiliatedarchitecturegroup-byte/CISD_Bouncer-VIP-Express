// ===========================================
// Push Notification Enhanced Service
// Phase 2.2 - Rich notifications
// ===========================================

import express, { Request, Response } from 'express';
import { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';

const app = express();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
app.use(express.json());

// ===========================================
// Notification Templates
// ===========================================

interface NotificationTemplate {
  id: string;
  name: string;
  title: string;
  body: string;
  icon?: string;
  image?: string;
  actions?: NotificationAction[];
  category?: string;
}

interface NotificationAction {
  id: string;
  title: string;
  action: string;
}

interface NotificationDelivery {
  id: string;
  user_id: string;
  template_id?: string;
  title: string;
  body: string;
  data?: any;
  status: 'pending' | 'sent' | 'delivered' | 'failed';
  sent_at?: string;
  delivered_at?: string;
  opened_at?: string;
  device?: string;
}

// Predefined templates
const templates: NotificationTemplate[] = [
  {
    id: 'new_booking',
    name: 'New Booking',
    title: 'New Booking Assigned',
    body: 'You have been assigned a new booking at {{venue}}',
    category: 'bookings',
    actions: [
      { id: 'view', title: 'View', action: 'VIEW_BOOKING' },
      { id: 'accept', title: 'Accept', action: 'ACCEPT_BOOKING' },
    ],
  },
  {
    id: 'shift_start',
    name: 'Shift Starting',
    title: 'Shift Starting Soon',
    body: 'Your shift at {{venue}} starts in {{minutes}} minutes',
    category: 'shifts',
    actions: [
      { id: 'checkin', title: 'Check In', action: 'CHECK_IN' },
    ],
  },
  {
    id: 'incident_alert',
    name: 'Incident Alert',
    title: 'Incident Reported',
    body: '{{type}} incident at {{venue}}',
    category: 'incidents',
    actions: [
      { id: 'respond', title: 'Respond', action: 'RESPOND' },
      { id: 'dismiss', title: 'Dismiss', action: 'DISMISS' },
    ],
  },
  {
    id: 'emergency',
    name: 'Emergency',
    title: '⚠️ EMERGENCY',
    body: '{{message}}',
    priority: 'high',
    category: 'emergency',
  },
];

// ===========================================
// Device Registration
// ===========================================

async function registerDevice(data: {
  user_id: string;
  device_token: string;
  platform: 'ios' | 'android';
  notification_key?: string;
}): Promise<void> {
  await pool.query(`
    INSERT INTO device_tokens (id, user_id, device_token, platform, notification_key, active)
    VALUES ($1, $2, $3, $4, $5, true)
    ON CONFLICT (user_id, device_token) DO UPDATE SET active = true
  `, [uuidv4(), data.user_id, data.device_token, data.platform, data.notification_key]);
}

async function unregisterDevice(userId: string, deviceToken: string): Promise<void> {
  await pool.query(`
    UPDATE device_tokens SET active = false 
    WHERE user_id = $1 AND device_token = $2
  `, [userId, deviceToken]);
}

async function getActiveDevices(userId: string): Promise<any[]> {
  const result = await pool.query(`
    SELECT * FROM device_tokens WHERE user_id = $1 AND active = true
  `, [userId]);
  return result.rows;
}

// ===========================================
// Notification sending
// ===========================================

async function sendNotification(
  userId: string,
  title: string,
  body: string,
  data?: any,
  templateId?: string
): Promise<{ sent: number; failed: number }> {
  const devices = await getActiveDevices(userId);
  let sent = 0, failed = 0;
  
  const deliveryId = uuidv4();
  const now = new Date().toISOString();
  
  for (const device of devices) {
    try {
      // In production, send via FCM/APNs
      if (device.platform === 'android') {
        // Send via FCM
        console.log(`FCM to ${device.device_token}: ${title}`);
      } else {
        // Send via APNs
        console.log(`APNs to ${device.device_token}: ${title}`);
      }
      
      // Log delivery
      await pool.query(`
        INSERT INTO notification_deliveries 
        (id, user_id, template_id, title, body, data, status, sent_at, device)
        VALUES ($1, $2, $3, $4, $5, $6, 'sent', $7, $8)
      `, [deliveryId, userId, templateId, title, body, JSON.stringify(data), now, device.device_token]);
      
      sent++;
    } catch (error) {
      failed++;
    }
  }
  
  return { sent, failed };
}

// Send to multiple users (broadcast)
async function broadcastNotification(
  userIds: string[],
  title: string,
  body: string,
  data?: any
): Promise<{ sent: number; failed: number }> {
  let totalSent = 0, totalFailed = 0;
  
  for (const userId of userIds) {
    const result = await sendNotification(userId, title, body, data);
    totalSent += result.sent;
    totalFailed += result.failed;
  }
  
  return { sent: totalSent, failed: totalFailed };
}

// ===========================================
// Delivery Tracking
// ===========================================

async function markDelivered(deliveryId: string): Promise<void> {
  const now = new Date().toISOString();
  await pool.query(`
    UPDATE notification_deliveries SET status = 'delivered', delivered_at = $1 WHERE id = $2
  `, [now, deliveryId]);
}

async function markOpened(deliveryId: string): Promise<void> {
  const now = new Date().toISOString();
  await pool.query(`
    UPDATE notification_deliveries SET status = 'opened', opened_at = $1 WHERE id = $2
  `, [now, deliveryId]);
}

async function getDeliveryStats(userId: string): Promise<any> {
  const result = await pool.query(`
    SELECT 
      COUNT(*) as total,
      SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) as sent,
      SUM(CASE WHEN status = 'delivered' THEN 1 ELSE 0 END) as delivered,
      SUM(CASE WHEN status = 'opened' THEN 1 ELSE 0 END) as opened,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
    FROM notification_deliveries WHERE user_id = $1
  `, [userId]);
  
  return result.rows[0];
}

// ===========================================
// API Routes
// ===========================================

app.post('/api/devices', async (req: Request, res: Response) => {
  await registerDevice(req.body);
  res.json({ success: true });
});

app.delete('/api/devices', async (req: Request, res: Response) => {
  const { user_id, device_token } = req.body;
  await unregisterDevice(user_id, device_token);
  res.json({ success: true });
});

app.get('/api/templates', (req: Request, res: Response) => {
  res.json({ success: true, data: templates });
});

app.post('/api/notifications', async (req: Request, res: Response) => {
  const { user_id, title, body, data, template_id } = req.body;
  const result = await sendNotification(user_id, title, body, data, template_id);
  res.json({ success: true, data: result });
});

app.post('/api/notifications/broadcast', async (req: Request, res: Response) => {
  const { user_ids, title, body, data } = req.body;
  const result = await broadcastNotification(user_ids, title, body, data);
  res.json({ success: true, data: result });
});

app.post('/api/notifications/:id/delivered', async (req: Request, res: Response) => {
  await markDelivered(req.params.id);
  res.json({ success: true });
});

app.post('/api/notifications/:id/opened', async (req: Request, res: Response) => {
  await markOpened(req.params.id);
  res.json({ success: true });
});

app.get('/api/notifications/stats/:userId', async (req: Request, res: Response) => {
  const stats = await getDeliveryStats(req.params.userId);
  res.json({ success: true, data: stats });
});

app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'healthy', service: 'push-enhanced' });
});

const PORT = process.env.PORT || 3201;
app.listen(PORT, () => console.log(`Push Enhanced Service on port ${PORT}`));

export default app;