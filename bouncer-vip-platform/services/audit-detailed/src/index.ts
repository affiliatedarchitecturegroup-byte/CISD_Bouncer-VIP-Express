// ===========================================
// Detailed Audit Trail Service
// Phase 1.5 - Full audit logging
// ===========================================

import express, { Request, Response } from 'express';
import { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';

const app = express();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
app.use(express.json());

// ===========================================
// Audit Event Types
// ===========================================

export enum AuditEventType {
  CREATE = 'create',
  READ = 'read',
  UPDATE = 'update',
  DELETE = 'delete',
  LOGIN = 'login',
  LOGOUT = 'logout',
  EXPORT = 'export',
  APPROVE = 'approve',
  REJECT = 'reject',
}

export enum AuditEntityType {
  USER = 'user',
  OFFICER = 'officer',
  VENUE = 'venue',
  BOOKING = 'booking',
  INVOICE = 'invoice',
  SHIFT = 'shift',
  INCIDENT = 'incident',
  REPORT = 'report',
  SETTINGS = 'settings',
}

// ===========================================
// Full Audit Entry
// ===========================================

interface AuditEntry {
  id: string;
  timestamp: string;
  user_id: string;
  user_email: string;
  event_type: AuditEventType;
  entity_type: AuditEntityType;
  entity_id: string;
  changes: Record<string, { old: any; new: any }>;
  metadata: {
    ip_address: string;
    user_agent: string;
    request_id: string;
    endpoint: string;
    method: string;
    status_code: number;
  };
  checksum: string;
}

// ===========================================
// Request Logging Middleware
// ===========================================

let secretKey = process.env.AUDIT_SECRET_KEY || 'default-secret';

export function computeChecksum(entry: Partial<AuditEntry>): string {
  const data = `${entry.timestamp}:${entry.user_id}:${entry.event_type}:${entry.entity_type}:${entry.entity_id}:${JSON.stringify(entry.changes)}`;
  return crypto.createHmac('sha256', secretKey).update(data).digest('hex');
}

// ===========================================
// Full Audit Logger
// ===========================================

async function logAudit(entry: Omit<AuditEntry, 'id' | 'timestamp' | 'checksum'>): Promise<AuditEntry> {
  const id = uuidv4();
  const timestamp = new Date().toISOString();
  
  const fullEntry: AuditEntry = {
    id,
    timestamp,
    ...entry,
    checksum: computeChecksum({ id, timestamp, ...entry } as any),
  };

  await pool.query(`
    INSERT INTO audit_trail (
      id, timestamp, user_id, user_email, event_type, entity_type, entity_id,
      changes, metadata, checksum
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
  `, [
    fullEntry.id,
    fullEntry.timestamp,
    fullEntry.user_id,
    fullEntry.user_email,
    fullEntry.event_type,
    fullEntry.entity_type,
    fullEntry.entity_id,
    JSON.stringify(fullEntry.changes),
    JSON.stringify(fullEntry.metadata),
    fullEntry.checksum,
  ]);

  return fullEntry;
}

// ===========================================
// Change Tracker
// ===========================================

export function trackChanges(oldData: any, newData: any): Record<string, { old: any; new: any }> {
  const changes: Record<string, { old: any; new: any }> = {};
  
  const allKeys = new Set([...Object.keys(oldData || {}), ...Object.keys(newData || {})]);
  
  for (const key of allKeys) {
    const oldVal = oldData?.[key];
    const newVal = newData?.[key];
    
    if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
      changes[key] = { old: oldVal, new: newVal };
    }
  }
  
  return changes;
}

// ===========================================
// Query with Filters
// ===========================================

interface AuditQuery {
  user_id?: string;
  entity_type?: AuditEntityType;
  entity_id?: string;
  event_type?: AuditEventType;
  from_date?: string;
  to_date?: string;
  page?: number;
  limit?: number;
}

async function queryAudit(query: AuditQuery): Promise<{ data: AuditEntry[]; total: number }> {
  let sql = 'SELECT * FROM audit_trail WHERE 1=1';
  const params: any[] = [];
  let paramIndex = 1;

  if (query.user_id) {
    params.push(query.user_id);
    sql += ` AND user_id = $${paramIndex++}`;
  }
  if (query.entity_type) {
    params.push(query.entity_type);
    sql += ` AND entity_type = $${paramIndex++}`;
  }
  if (query.entity_id) {
    params.push(query.entity_id);
    sql += ` AND entity_id = $${paramIndex++}`;
  }
  if (query.event_type) {
    params.push(query.event_type);
    sql += ` AND event_type = $${paramIndex++}`;
  }
  if (query.from_date) {
    params.push(query.from_date);
    sql += ` AND timestamp >= $${paramIndex++}`;
  }
  if (query.to_date) {
    params.push(query.to_date);
    sql += ` AND timestamp <= $${paramIndex++}`;
  }

  // Get total
  const countSql = sql.replace('SELECT *', 'SELECT COUNT(*) as total');
  const countResult = await pool.query(countSql, params);
  const total = parseInt(countResult.rows[0]?.total || '0');

  // Add pagination
  const page = query.page || 1;
  const limit = Math.min(query.limit || 50, 100);
  sql += ` ORDER BY timestamp DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
  params.push(limit, (page - 1) * limit);

  const result = await pool.query(sql, params);
  
  return {
    data: result.rows.map(r => ({
      ...r,
      changes: JSON.parse(r.changes || '{}'),
      metadata: JSON.parse(r.metadata || '{}'),
    })),
    total,
  };
}

// ===========================================
// Compliance Export
// ===========================================

async function exportCompliance(startDate: string, endDate: string, format: 'csv' | 'json' = 'json'): Promise<string> {
  const { data } = await queryAudit({ from_date: startDate, to_date: endDate, limit: 10000 });
  
  if (format === 'csv') {
    const headers = ['timestamp', 'user_email', 'event_type', 'entity_type', 'entity_id'];
    const rows = data.map(d => [
      d.timestamp,
      d.user_email,
      d.event_type,
      d.entity_type,
      d.entity_id,
    ].join(','));
    return [headers.join(','), ...rows].join('\n');
  }
  
  return JSON.stringify(data, null, 2);
}

// ===========================================
// Integrity Verification
// ===========================================

async function verifyIntegrity(entry: AuditEntry): Promise<boolean> {
  const stored = await pool.query('SELECT checksum FROM audit_trail WHERE id = $1', [entry.id]);
  if (!stored.rows[0]) return false;
  return stored.rows[0].checksum === entry.checksum;
}

// ===========================================
// API Routes
// ===========================================

app.post('/api/audit', async (req: Request, res: Response) => {
  const entry = await logAudit(req.body);
  res.json({ success: true, data: entry });
});

app.get('/api/audit', async (req: Request, res: Response) => {
  const { data, total } = await queryAudit(req.query as any);
  res.json({ success: true, data, total });
});

app.get('/api/audit/entity/:type/:id', async (req: Request, res: Response) => {
  const { data } = await queryAudit({
    entity_type: req.params.type as AuditEntityType,
    entity_id: req.params.id,
  });
  res.json({ success: true, data });
});

app.get('/api/audit/user/:id', async (req: Request, res: Response) => {
  const { data } = await queryAudit({ user_id: req.params.id });
  res.json({ success: true, data });
});

app.get('/api/compliance/export', async (req: Request, res: Response) => {
  const { start_date, end_date, format } = req.query;
  const exportData = await exportCompliance(start_date as string, end_date as string, format as any);
  
  res.setHeader('Content-Type', format === 'csv' ? 'text/csv' : 'application/json');
  res.send(exportData);
});

app.get('/api/audit/verify/:id', async (req: Request, res: Response) => {
  const { data } = await queryAudit({ entity_id: req.params.id, limit: 1 });
  const entry = data[0];
  if (!entry) return res.status(404).json({ success: false, error: 'Not found' });
  
  const valid = await verifyIntegrity(entry);
  res.json({ success: true, valid });
});

app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'healthy', service: 'audit-detailed' });
});

const PORT = process.env.PORT || 3089;
app.listen(PORT, () => console.log(`Detailed Audit Trail Service on port ${PORT}`));

export default app;