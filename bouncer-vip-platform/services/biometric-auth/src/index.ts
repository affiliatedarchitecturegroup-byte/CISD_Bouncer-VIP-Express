// ===========================================
// Biometric Authentication Service
// Phase 2.3 - Fingerprint/Face ID
// ===========================================

import express, { Request, Response } from 'express';
import { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';

const app = express();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
app.use(express.json());

// ===========================================
// Biometric Types
// ===========================================

type BiometricType = 'fingerprint' | 'face_id' | 'iris';

interface BiometricEnrollment {
  id: string;
  user_id: string;
  biometric_type: BiometricType;
  device_id: string;
  public_key: string;
  encrypted_private_key: string;
  enrolled_at: string;
  last_used?: string;
  active: boolean;
}

interface BiometricChallenge {
  id: string;
  user_id: string;
  challenge: string;
  expires_at: string;
  verified: boolean;
}

// ===========================================
// Key Generation
// ===========================================

function generateKeyPair() {
  // In production, use proper key generation
  return {
    publicKey: crypto.randomBytes(32).toString('hex'),
    privateKey: crypto.randomBytes(64).toString('hex'),
  };
}

function generateChallenge(): string {
  return crypto.randomBytes(32).toString('hex');
}

function hashBiometric(data: string): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

// ===========================================
// Enrollment
// ===========================================

async function enrollBiometric(
  userId: string,
  biometricType: BiometricType,
  deviceId: string,
  biometricData: string
): Promise<BiometricEnrollment> {
  const id = uuidv4();
  const keys = generateKeyPair();
  
  // In production, store encrypted biometric template
  const biometricHash = hashBiometric(biometricData);
  
  await pool.query(`
    INSERT INTO biometric_enrollments 
    (id, user_id, biometric_type, device_id, public_key, encrypted_private_key, biometric_hash, enrolled_at, active)
    VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), true)
  `, [id, userId, biometricType, deviceId, keys.publicKey, keys.privateKey, biometricHash]);

  return {
    id,
    user_id: userId,
    biometric_type: biometricType,
    device_id: deviceId,
    public_key: keys.publicKey,
    encrypted_private_key: keys.privateKey,
    enrolled_at: new Date().toISOString(),
    active: true,
  };
}

async function getEnrollments(userId: string): Promise<BiometricEnrollment[]> {
  const result = await pool.query(`
    SELECT * FROM biometric_enrollments WHERE user_id = $1 AND active = true
  `, [userId]);
  
  return result.rows;
}

async function removeEnrollment(enrollmentId: string): Promise<void> {
  await pool.query(`
    UPDATE biometric_enrollments SET active = false WHERE id = $1
  `, [enrollmentId]);
}

// ===========================================
// Authentication
// ===========================================

async function createChallenge(userId: string): Promise<BiometricChallenge> {
  const id = uuidv4();
  const challenge = generateChallenge();
  const expires = new Date(Date.now() + 5 * 60 * 1000).toISOString(); // 5 minutes
  
  await pool.query(`
    INSERT INTO biometric_challenges (id, user_id, challenge, expires_at, verified)
    VALUES ($1, $2, $3, $4, false)
  `, [id, userId, challenge, expires]);
  
  return { id, user_id: userId, challenge, expires_at: expires, verified: false };
}

async function verifyBiometric(
  challengeId: string,
  biometricData: string,
  deviceId: string
): Promise<boolean> {
  // Get challenge
  const challengeResult = await pool.query(`
    SELECT * FROM biometric_challenges WHERE id = $1 AND expires_at > NOW()
  `, [challengeId]);
  
  if (challengeResult.rows.length === 0) {
    return false;
  }
  
  const challenge = challengeResult.rows[0];
  
  // Get enrolled biometric
  const enrollmentResult = await pool.query(`
    SELECT * FROM biometric_enrollments 
    WHERE user_id = $2 AND device_id = $3 AND active = true
    LIMIT 1
  `, [challenge.user_id, deviceId]);
  
  if (enrollmentResult.rows.length === 0) {
    return false;
  }
  
  const enrollment = enrollmentResult.rows[0];
  
  // Verify biometric
  const biometricHash = hashBiometric(biometricData);
  const isValid = biometricHash === enrollment.biometric_hash;
  
  // Update challenge
  await pool.query(`
    UPDATE biometric_challenges SET verified = $1 WHERE id = $2
  `, [isValid, challengeId]);
  
  // Update enrollment last used
  if (isValid) {
    await pool.query(`
      UPDATE biometric_enrollments SET last_used = NOW() WHERE id = $1
    `, [enrollment.id]);
  }
  
  return isValid;
}

// ===========================================
// PIN Fallback
// ===========================================

async function setPIN(userId: string, pin: string): Promise<void> {
  const hashedPin = crypto.createHash('sha256').update(pin).digest('hex');
  
  await pool.query(`
    INSERT INTO user_pins (user_id, pin_hash, created_at)
    VALUES ($1, $2, NOW())
    ON CONFLICT (user_id) DO UPDATE SET pin_hash = $2
  `, [userId, hashedPin]);
}

async function verifyPIN(userId: string, pin: string): Promise<boolean> {
  const hashedPin = crypto.createHash('sha256').update(pin).digest('hex');
  
  const result = await pool.query(`
    SELECT * FROM user_pins WHERE user_id = $1 AND pin_hash = $2
  `, [userId, hashedPin]);
  
  return result.rows.length > 0;
}

// ===========================================
// Security Settings
// ===========================================

interface SecuritySettings {
  require_biometric: boolean;
  require_pin: boolean;
  max_failed_attempts: number;
  lockout_duration: number;
  session_timeout: number;
}

const defaultSettings: SecuritySettings = {
  require_biometric: true,
  require_pin: true,
  max_failed_attempts: 5,
  lockout_duration: 300, // 5 minutes
  session_timeout: 3600, // 1 hour
};

async function getSecuritySettings(userId: string): Promise<SecuritySettings> {
  const result = await pool.query(`
    SELECT * FROM user_security_settings WHERE user_id = $1
  `, [userId]);
  
  return result.rows[0] || defaultSettings;
}

async function updateSecuritySettings(userId: string, settings: Partial<SecuritySettings>): Promise<void> {
  // Upsert settings
  await pool.query(`
    INSERT INTO user_security_settings (user_id, require_biometric, require_pin, max_failed_attempts, lockout_duration, session_timeout)
    VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (user_id) DO UPDATE SET
      require_biometric = $2,
      require_pin = $3,
      max_failed_attempts = $4,
      lockout_duration = $5,
      session_timeout = $6
  `, [userId, settings.require_biometric ?? true, settings.require_pin ?? true, 
      settings.max_failed_attempts ?? 5, settings.lockout_duration ?? 300, settings.session_timeout ?? 3600]);
}

// ===========================================
// API Routes
// ===========================================

app.post('/api/biometric/enroll', async (req: Request, res: Response) => {
  const { user_id, biometric_type, device_id, biometric_data } = req.body;
  const enrollment = await enrollBiometric(user_id, biometric_type, device_id, biometric_data);
  res.json({ success: true, data: enrollment });
});

app.get('/api/biometric/enrollments/:userId', async (req: Request, res: Response) => {
  const enrollments = await getEnrollments(req.params.userId);
  res.json({ success: true, data: enrollments });
});

app.delete('/api/biometric/enrollments/:id', async (req: Request, res: Response) => {
  await removeEnrollment(req.params.id);
  res.json({ success: true });
});

app.post('/api/biometric/challenge', async (req: Request, res: Response) => {
  const { user_id } = req.body;
  const challenge = await createChallenge(user_id);
  res.json({ success: true, data: challenge });
});

app.post('/api/biometric/verify', async (req: Request, res: Response) => {
  const { challenge_id, biometric_data, device_id } = req.body;
  const verified = await verifyBiometric(challenge_id, biometric_data, device_id);
  res.json({ success: verified });
});

app.post('/api/auth/pin', async (req: Request, res: Response) => {
  const { user_id, pin } = req.body;
  await setPIN(user_id, pin);
  res.json({ success: true });
});

app.post('/api/auth/pin/verify', async (req: Request, res: Response) => {
  const { user_id, pin } = req.body;
  const verified = await verifyPIN(user_id, pin);
  res.json({ success: verified });
});

app.get('/api/security/:userId', async (req: Request, res: Response) => {
  const settings = await getSecuritySettings(req.params.userId);
  res.json({ success: true, data: settings });
});

app.put('/api/security/:userId', async (req: Request, res: Response) => {
  await updateSecuritySettings(req.params.userId, req.body);
  res.json({ success: true });
});

app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'healthy', service: 'biometric-auth' });
});

const PORT = process.env.PORT || 3202;
app.listen(PORT, () => console.log(`Biometric Auth Service on port ${PORT}`));

export default app;