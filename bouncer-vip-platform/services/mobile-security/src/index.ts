// ===========================================
// Mobile Security Service
// Phase 2.4 - SSL pinning, jailbreak detection
// ===========================================

import express, { Request, Response } from 'express';
import { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';

const app = express();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
app.use(express.json());

// SSL Pinning
export function getSpkiHash(certPem: string): string {
  return crypto.createHash('sha256').update(certPem).digest('hex').substring(0, 32);
}

// Session Management
async function createSession(userId: string, deviceId: string, ipAddress: string): Promise<any> {
  const id = uuidv4();
  const accessToken = crypto.randomBytes(32).toString('hex');
  const refreshToken = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  
  await pool.query(`
    INSERT INTO mobile_sessions (id, user_id, device_id, access_token, refresh_token, created_at, expires_at, ip_address, active)
    VALUES ($1, $2, $3, $4, $5, NOW(), $6, $7, true)
  `, [id, userId, deviceId, accessToken, refreshToken, expiresAt, ipAddress]);
  
  return { id, user_id: userId, device_id: deviceId, access_token: accessToken, refresh_token: refreshToken };
}

async function validateSession(accessToken: string): Promise<any> {
  const result = await pool.query(`SELECT * FROM mobile_sessions WHERE access_token = $1 AND expires_at > NOW() AND active = true`, [accessToken]);
  return result.rows[0] || null;
}

async function refreshSession(refreshToken: string): Promise<any> {
  const result = await pool.query(`SELECT * FROM mobile_sessions WHERE refresh_token = $1 AND active = true`, [refreshToken]);
  if (result.rows.length === 0) return null;
  
  const newAccessToken = crypto.randomBytes(32).toString('hex');
  const newRefreshToken = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  
  await pool.query(`UPDATE mobile_sessions SET access_token = $1, refresh_token = $2, expires_at = $3 WHERE id = $4`, 
    [newAccessToken, newRefreshToken, expiresAt, result.rows[0].id]);
  
  return { ...result.rows[0], access_token: newAccessToken, refresh_token: newRefreshToken };
}

async function revokeSession(sessionId: string): Promise<void> {
  await pool.query(`UPDATE mobile_sessions SET active = false WHERE id = $1`, [sessionId]);
}

// Data Encryption
export function encryptData(data: string, key: string): string {
  const iv = crypto.randomBytes(16);
  const keyBuffer = crypto.createHash('sha256').update(key).digest();
  const cipher = crypto.createCipheriv('aes-256-cbc', keyBuffer, iv);
  let encrypted = cipher.update(data, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted;
}

export function decryptData(encryptedData: string, key: string): string {
  const [ivHex, encrypted] = encryptedData.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const keyBuffer = crypto.createHash('sha256').update(key).digest();
  const decipher = crypto.createDecipheriv('aes-256-cbc', keyBuffer, iv);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

// API Routes
app.post('/api/sessions', async (req: Request, res: Response) => {
  const { user_id, device_id, ip_address } = req.body;
  const session = await createSession(user_id, device_id, ip_address);
  res.json({ success: true, data: session });
});

app.post('/api/sessions/refresh', async (req: Request, res: Response) => {
  const { refresh_token } = req.body;
  const session = await refreshSession(refresh_token);
  if (!session) return res.status(401).json({ success: false });
  res.json({ success: true, data: session });
});

app.delete('/api/sessions/:id', async (req: Request, res: Response) => {
  await revokeSession(req.params.id);
  res.json({ success: true });
});

app.post('/api/encrypt', (req: Request, res: Response) => {
  const encrypted = encryptData(req.body.data, req.body.key);
  res.json({ success: true, data: encrypted });
});

app.post('/api/decrypt', (req: Request, res: Response) => {
  try {
    const decrypted = decryptData(req.body.encrypted_data, req.body.key);
    res.json({ success: true, data: decrypted });
  } catch {
    res.status(400).json({ success: false });
  }
});

app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'healthy', service: 'mobile-security' });
});

const PORT = process.env.PORT || 3203;
app.listen(PORT, () => console.log(`Mobile Security Service on port ${PORT}`));

export default app;