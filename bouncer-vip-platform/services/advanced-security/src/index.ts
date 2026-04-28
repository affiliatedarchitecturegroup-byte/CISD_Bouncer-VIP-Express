// ===========================================
// Advanced Security Service
// SSO, 2FA, audit logging & threat detection
// ===========================================

import express, { Request, Response } from 'express';
import { Pool } from 'pg';
import Redis from 'ioredis';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';

const app = express();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const redis = new Redis(process.env.REDIS_URL);

app.use(express.json());

// ===========================================
// Types
// ===========================================

type AuthProvider = 'email' | 'google' | 'microsoft' | 'saml';
type MFAType = 'totp' | 'sms' | 'email';

interface UserAuth {
  user_id: string;
  provider: AuthProvider;
  provider_id?: string;
  password_hash?: string;
  mfa_enabled: boolean;
  mfa_type?: MFAType;
  last_login?: string;
  failed_attempts: number;
  locked_until?: string;
}

// ===========================================
// Password Security
// ===========================================

const SALT_ROUNDS = 12;

async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = await Bun.password.hash(password + salt);
  return `${salt}:${hash}`;
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [salt, hash] = stored.split(':');
  return Bun.password.verify(password + salt, hash);
}

function generatePasswordRequirements(): { minLength: number; requireUpper: boolean; requireNumber: boolean; requireSpecial: boolean } {
  return {
    minLength: 12,
    requireUpper: true,
    requireNumber: true,
    requireSpecial: true,
  };
}

function validatePassword(password: string): { valid: boolean; errors: string[] } {
  const req = generatePasswordRequirements();
  const errors: string[] = [];
  
  if (password.length < req.minLength) errors.push(`Minimum ${req.minLength} characters`);
  if (req.requireUpper && !/[A-Z]/.test(password)) errors.push('At least one uppercase letter');
  if (req.requireNumber && !/[0-9]/.test(password)) errors.push('At least one number');
  if (req.requireSpecial && !/[!@#$%^&*]/.test(password)) errors.push('At least one special character');
  
  return { valid: errors.length === 0, errors };
}

// ===========================================
// Authentication
// ===========================================

async function authenticateUser(email: string, password: string): Promise<{ success: boolean; user_id?: string; mfa_required?: boolean; error?: string }> {
  const user = await pool.query('SELECT * FROM user_auth WHERE email = $1', [email]);
  
  if (!user.rows[0]) {
    return { success: false, error: 'Invalid credentials' };
  }
  
  const auth = user.rows[0];
  
  // Check if locked
  if (auth.locked_until && new Date(auth.locked_until) > new Date()) {
    return { success: false, error: 'Account locked. Try again later.' };
  }
  
  // Verify password
  const valid = await verifyPassword(password, auth.password_hash);
  if (!valid) {
    // Increment failed attempts
    await pool.query(`
      UPDATE user_auth SET failed_attempts = failed_attempts + 1,
        locked_until = CASE WHEN failed_attempts >= 4 THEN NOW() + INTERVAL '30 minutes' ELSE locked_until END
      WHERE user_id = $1
    `, [auth.user_id]);
    
    return { success: false, error: 'Invalid credentials' };
  }
  
  // Reset failed attempts
  await pool.query('UPDATE user_auth SET failed_attempts = 0, last_login = NOW() WHERE user_id = $1', [auth.user_id]);
  
  // Check MFA
  if (auth.mfa_enabled) {
    return { success: true, user_id: auth.user_id, mfa_required: true };
  }
  
  return { success: true, user_id: auth.user_id };
}

// ===========================================
// Multi-Factor Authentication
// ===========================================

async function setupTOTP(userId: string): Promise<{ secret: string; qr_url: string }> {
  const secret = crypto.randomBytes(20).toString('base32');
  
  await pool.query(`
    UPDATE user_auth SET mfa_secret = $1, mfa_type = 'totp' WHERE user_id = $2
  `, [secret, userId]);
  
  // In production, generate QR code
  const qrUrl = `otpauth://totp/BouncerVIP:user?secret=${secret}&issuer=BouncerVIP`;
  
  return { secret, qr_url: qrUrl };
}

async function verifyTOTP(userId: string, code: string): Promise<boolean> {
  const user = await pool.query('SELECT mfa_secret FROM user_auth WHERE user_id = $1', [userId]);
  const secret = user.rows[0]?.mfa_secret;
  
  if (!secret) return false;
  
  // In production, use otplib to verify
  // const isValid = authenticator.verify({ token: code, secret });
  return true; // Simplified
}

async function sendMFACode(userId: string, type: MFAType): Promise<void> {
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  
  await redis.setex(`mfa:${userId}`, 300, code); // 5 minutes
  
  if (type === 'sms') {
    const user = await pool.query('SELECT phone FROM users WHERE id = $1', [userId]);
    // await smsService.send(user.rows[0].phone, `Your BouncerVIP code: ${code}`);
  } else if (type === 'email') {
    const user = await pool.query('SELECT email FROM users WHERE id = $1', [userId]);
    // await emailService.send(user.rows[0].email, 'Your BouncerVIP code', code);
  }
}

// ===========================================
// SSO Integration (SAML)
// ===========================================

interface SAMLConfig {
  entry_point: string;
  issuer: string;
  cert: string;
}

async function initiateSAMLLogin(idp: string): Promise<{ url: string; id: string }> {
  const requestId = uuidv4();
  
  // Store request for later validation
  await redis.setex(`saml:request:${requestId}`, 300, idp);
  
  const samlUrls: Record<string, string> = {
    okta: `https://${idp}.okta.com/app/${process.env.OKTA_APP_ID}/sso/saml`,
    azure: `https://login.microsoftonline.com/${process.env.AZURE_TENANT_ID}/saml2`,
    onelogin: `https://${idp}.onelogin.com/trust/saml2/http-post/sso`,
  };
  
  return {
    url: samlUrls[idp] || '',
    id: requestId,
  };
}

async function validateSAMLResponse(response: string): Promise<{ user_id: string; email: string; name_id: string }> {
  // In production, use passport-saml
  // Parse SAML response
  // Extract user attributes
  
  return {
    user_id: uuidv4(),
    email: 'user@example.com',
    name_id: 'user@example.com',
  };
}

// ===========================================
// Session Management
// ===========================================

interface Session {
  id: string;
  user_id: string;
  ip_address: string;
  user_agent: string;
  created_at: string;
  expires_at: string;
}

async function createSession(userId: string, ipAddress: string, userAgent: string): Promise<string> {
  const sessionId = uuidv4();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
  
  await pool.query(`
    INSERT INTO sessions (id, user_id, ip_address, user_agent, expires_at)
    VALUES ($1, $2, $3, $4, $5)
  `, [sessionId, userId, ipAddress, userAgent, expiresAt]);
  
  // Store in Redis for quick lookup
  await redis.setex(`session:${sessionId}`, 86400, userId);
  
  return sessionId;
}

async function validateSession(sessionId: string): Promise<string | null> {
  // Check Redis first
  const cached = await redis.get(`session:${sessionId}`);
  if (cached) return cached;
  
  // Check database
  const session = await pool.query(`
    SELECT user_id, expires_at FROM sessions WHERE id = $1 AND expires_at > NOW()
  `, [sessionId]);
  
  if (!session.rows[0]) return null;
  
  // Refresh in Redis
  await redis.setex(`session:${sessionId}`, 86400, session.rows[0].user_id);
  
  return session.rows[0].user_id;
}

async function revokeSession(sessionId: string): Promise<void> {
  await pool.query('DELETE FROM sessions WHERE id = $1', [sessionId]);
  await redis.del(`session:${sessionId}`);
}

async function revokeAllUserSessions(userId: string): Promise<void> {
  await pool.query('DELETE FROM sessions WHERE user_id = $1', [userId]);
  await redis.keys(`session:*`).then(keys => keys.forEach(k => redis.del(k)));
}

// ===========================================
// Audit Logging
// ===========================================

interface AuditEvent {
  user_id: string;
  action: string;
  resource: string;
  resource_id?: string;
  ip_address: string;
  user_agent: string;
  metadata?: Record<string, any>;
}

async function logAuditEvent(event: AuditEvent): Promise<void> {
  await pool.query(`
    INSERT INTO audit_logs (id, user_id, action, resource, resource_id, ip_address, user_agent, metadata, created_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
  `, [uuidv4(), event.user_id, event.action, event.resource, event.resource_id, event.ip_address, event.user_agent, JSON.stringify(event.metadata || {})]);
}

async function getAuditLogs(filters: {
  user_id?: string;
  action?: string;
  resource?: string;
  from?: string;
  to?: string;
}): Promise<any[]> {
  let query = 'SELECT * FROM audit_logs WHERE 1=1';
  const params: any[] = [];
  
  if (filters.user_id) { params.push(filters.user_id); query += ` AND user_id = $${params.length}`; }
  if (filters.action) { params.push(filters.action); query += ` AND action = $${params.length}`; }
  if (filters.resource) { params.push(filters.resource); query += ` AND resource = $${params.length}`; }
  if (filters.from) { params.push(filters.from); query += ` AND created_at >= $${params.length}`; }
  if (filters.to) { params.push(filters.to); query += ` AND created_at <= $${params.length}`; }
  
  query += ' ORDER BY created_at DESC LIMIT 1000';
  
  const result = await pool.query(query, params);
  return result.rows;
}

// ===========================================
// Threat Detection
// ===========================================

interface ThreatEvent {
  type: 'brute_force' | 'suspicious_login' | 'unusual_location' | 'credential_stuffing';
  severity: 'low' | 'medium' | 'high' | 'critical';
  source_ip: string;
  user_id?: string;
  details: Record<string, any>;
}

async function detectThreat(sourceIp: string, userId?: string): Promise<ThreatEvent | null> {
  // Check for brute force
  const failedCount = await redis.incr(`threat:failed:${sourceIp}`);
  if (failedCount > 10) {
    return {
      type: 'brute_force',
      severity: 'high',
      source_ip: sourceIp,
      user_id: userId,
      details: { failed_attempts: failedCount },
    };
  }
  
  // Check for unusual location (simplified)
  const lastIp = await redis.get(`user:${userId}:last_ip`);
  if (lastIp && lastIp !== sourceIp) {
    // Check if new location is vastly different (in production, use GeoIP)
    return {
      type: 'unusual_location',
      severity: 'medium',
      source_ip: sourceIp,
      user_id: userId,
      details: { previous_ip: lastIp },
    };
  }
  
  return null;
}

async function blockIp(sourceIp: string, duration: number = 3600): Promise<void> {
  await redis.setex(`blocked:${sourceIp}`, duration, 'blocked');
  
  // Log the block
  await logAuditEvent({
    user_id: 'system',
    action: 'ip_blocked',
    resource: 'security',
    ip_address: sourceIp,
    user_agent: 'system',
    metadata: { duration },
  });
}

async function isIpBlocked(sourceIp: string): Promise<boolean> {
  const blocked = await redis.get(`blocked:${sourceIp}`);
  return blocked === 'blocked';
}

// ===========================================
// API Routes
// ===========================================

// Auth
app.post('/api/auth/login', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;
    const result = await authenticateUser(email, password);
    
    if (result.success) {
      await logAuditEvent({
        user_id: result.user_id!,
        action: 'login',
        resource: 'auth',
        ip_address: req.ip || '',
        user_agent: req.headers['user-agent'] || '',
      });
    }
    
    res.json({ success, ...result });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Authentication failed' });
  }
});

app.post('/api/auth/logout', async (req: Request, res: Response) => {
  try {
    const sessionId = req.headers['x-session-id'] as string;
    await revokeSession(sessionId);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Logout failed' });
  }
});

// MFA
app.post('/api/auth/mfa/setup', async (req: Request, res: Response) => {
  try {
    const { user_id } = req.body;
    const result = await setupTOTP(user_id);
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: 'MFA setup failed' });
  }
});

app.post('/api/auth/mfa/verify', async (req: Request, res: Response) => {
  try {
    const { user_id, code } = req.body;
    const valid = await verifyTOTP(user_id, code);
    res.json({ success: valid });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Verification failed' });
  }
});

// Audit
app.get('/api/audit', async (req: Request, res: Response) => {
  try {
    const logs = await getAuditLogs(req.query as any);
    res.json({ success: true, data: logs });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch audit logs' });
  }
});

// Security
app.get('/api/security/threats', async (req: Request, res: Response) => {
  try {
    const threats = await detectThreat(req.ip || '', req.headers['x-user-id'] as string);
    res.json({ success: true, data: threats });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Threat detection failed' });
  }
});

app.post('/api/security/block', async (req: Request, res: Response) => {
  try {
    const { ip, duration } = req.body;
    await blockIp(ip, duration);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Block failed' });
  }
});

app.get('/health', async (req: Request, res: Response) => {
  res.json({ status: 'healthy', service: 'advanced-security' });
});

const PORT = process.env.PORT || 3025;

app.listen(PORT, () => console.log(`Advanced Security Service on port ${PORT}`));

export default app;