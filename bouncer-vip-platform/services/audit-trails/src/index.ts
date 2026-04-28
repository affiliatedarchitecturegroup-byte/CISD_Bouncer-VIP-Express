// ===========================================
// Audit Trails Service
// Full compliance logging
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

type AuditAction = 'create' | 'read' | 'update' | 'delete' | 'login' | 'logout' | 'export' | 'approve' | 'reject';
type AuditEntity = 'user' | 'officer' | 'venue' | 'booking' | 'invoice' | 'incident' | 'shift' | 'report' | 'settings';

interface AuditEntry {
  id: string;
  timestamp: string;
  user_id: string;
  user_email: string;
  action: AuditAction;
  entity_type: AuditEntity;
  entity_id: string;
  old_values?: Record<string, any>;
  new_values?: Record<string, any>;
  ip_address: string;
  user_agent?: string;
  session_id?: string;
  checksum: string;
}

// ===========================================
// Audit Logger
// ===========================================

class AuditLogger {
  private secretKey: string;

  constructor() {
    this.secretKey = process.env.AUDIT_SECRET_KEY || 'default-secret';
  }

  async log(entry: Omit<AuditEntry, 'id' | 'timestamp' | 'checksum'>): Promise<AuditEntry> {
    const id = uuidv4();
    const timestamp = new Date().toISOString();
    
    // Create checksum for integrity
    const data = `${id}:${timestamp}:${entry.user_id}:${entry.action}:${entry.entity_type}:${entry.entity_id}`;
    const checksum = crypto
      .createHmac('sha256', this.secretKey)
      .update(data)
      .digest('hex');

    const fullEntry: AuditEntry = {
      id,
      timestamp,
      ...entry,
      checksum,
    };

    // Store in database
    await pool.query(`
      INSERT INTO audit_logs (
        id, timestamp, user_id, user_email, action, entity_type, entity_id,
        old_values, new_values, ip_address, user_agent, session_id, checksum
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
    `, [
      fullEntry.id,
      fullEntry.timestamp,
      fullEntry.user_id,
      fullEntry.user_email,
      fullEntry.action,
      fullEntry.entity_type,
      fullEntry.entity_id,
      fullEntry.old_values ? JSON.stringify(fullEntry.old_values) : null,
      fullEntry.new_values ? JSON.stringify(fullEntry.new_values) : null,
      fullEntry.ip_address,
      fullEntry.user_agent,
      fullEntry.session_id,
      fullEntry.checksum,
    ]);

    return fullEntry;
  }

  async verifyIntegrity(entry: AuditEntry): Promise<boolean> {
    const data = `${entry.id}:${entry.timestamp}:${entry.user_id}:${entry.action}:${entry.entity_type}:${entry.entity_id}`;
    const expectedChecksum = crypto
      .createHmac('sha256', this.secretKey)
      .update(data)
      .digest('hex');

    return entry.checksum === expectedChecksum;
  }
}

const auditLogger = new AuditLogger();

// ===========================================
// Query Builder
// ===========================================

class AuditQueryBuilder {
  async search(filters: {
    user_id?: string;
    action?: AuditAction;
    entity_type?: AuditEntity;
    entity_id?: string;
    from_date?: string;
    to_date?: string;
    ip_address?: string;
    limit?: number;
    offset?: number;
  }): Promise<AuditEntry[]> {
    let query = 'SELECT * FROM audit_logs WHERE 1=1';
    const params: any[] = [];
    let paramIndex = 1;

    if (filters.user_id) {
      params.push(filters.user_id);
      query += ` AND user_id = $${paramIndex++}`;
    }
    if (filters.action) {
      params.push(filters.action);
      query += ` AND action = $${paramIndex++}`;
    }
    if (filters.entity_type) {
      params.push(filters.entity_type);
      query += ` AND entity_type = $${paramIndex++}`;
    }
    if (filters.entity_id) {
      params.push(filters.entity_id);
      query += ` AND entity_id = $${paramIndex++}`;
    }
    if (filters.from_date) {
      params.push(filters.from_date);
      query += ` AND timestamp >= $${paramIndex++}`;
    }
    if (filters.to_date) {
      params.push(filters.to_date);
      query += ` AND timestamp <= $${paramIndex++}`;
    }
    if (filters.ip_address) {
      params.push(filters.ip_address);
      query += ` AND ip_address = $${paramIndex++}`;
    }

    query += ' ORDER BY timestamp DESC';

    if (filters.limit) {
      params.push(filters.limit);
      query += ` LIMIT $${paramIndex++}`;
    }
    if (filters.offset) {
      params.push(filters.offset);
      query += ` OFFSET $${paramIndex++}`;
    }

    const result = await pool.query(query, params);
    return result.rows;
  }

  async getByEntity(entityType: AuditEntity, entityId: string): Promise<AuditEntry[]> {
    return this.search({ entity_type: entityType, entity_id: entityId });
  }

  async getByUser(userId: string, limit: number = 100): Promise<AuditEntry[]> {
    return this.search({ user_id: userId, limit });
  }

  async getByDateRange(from: string, to: string): Promise<AuditEntry[]> {
    return this.search({ from_date: from, to_date: to });
  }
}

const auditQuery = new AuditQueryBuilder();

// ===========================================
// Compliance Reports
// ===========================================

async function generateComplianceReport(startDate: string, endDate: string): Promise<any> {
  const entries = await auditQuery.getByDateRange(startDate, endDate);

  const byUser: Record<string, number> = {};
  const byAction: Record<string, number> = {};
  const byEntity: Record<string, number> = {};

  for (const entry of entries) {
    byUser[entry.user_email] = (byUser[entry.user_email] || 0) + 1;
    byAction[entry.action] = (byAction[entry.action] || 0) + 1;
    byEntity[entry.entity_type] = (byEntity[entry.entity_type] || 0) + 1;
  }

  return {
    period: { start: startDate, end: endDate },
    total_entries: entries.length,
    by_user: byUser,
    by_action: byAction,
    by_entity: byEntity,
    generated_at: new Date().toISOString(),
  };
}

async function detectAnomalies(): Promise<any[]> {
  const anomalies: any[] = [];

  // Detect unusual activity
  const result = await pool.query(`
    SELECT user_id, COUNT(*) as count, MAX(timestamp) as last_action
    FROM audit_logs
    WHERE timestamp > NOW() - INTERVAL '1 hour'
    GROUP BY user_id
    HAVING COUNT(*) > 1000
  `);

  for (const row of result.rows) {
    anomalies.push({
      type: 'high_activity',
      user_id: row.user_id,
      count: parseInt(row.count),
      last_action: row.last_action,
    });
  }

  // Detect off-hours access
  const offHours = await pool.query(`
    SELECT * FROM audit_logs
    WHERE EXTRACT(HOUR FROM timestamp) < 6 OR EXTRACT(HOUR FROM timestamp) > 22
    AND timestamp > NOW() - INTERVAL '24 hours'
    LIMIT 100
  `);

  if (offHours.rows.length > 0) {
    anomalies.push({
      type: 'off_hours_access',
      count: offHours.rows.length,
      entries: offHours.rows.slice(0, 10),
    });
  }

  return anomalies;
}

// ===========================================
// Middleware
// ===========================================

export function auditMiddleware(action: AuditAction, entityType: AuditEntity) {
  return async (req: Request, res: Response, next: NextFunction) => {
    // Store original send
    const originalSend = res.send.bind(res);
    
    res.send = function(body: any) {
      // Only log successful operations
      if (res.statusCode >= 200 && res.statusCode < 300) {
        const userId = (req as any).user?.id || 'anonymous';
        const userEmail = (req as any).user?.email || 'anonymous';
        
        auditLogger.log({
          user_id: userId,
          user_email: userEmail,
          action,
          entity_type: entityType,
          entity_id: req.params.id || 'bulk',
          old_values: (req as any).body?._oldValues,
          new_values: (req as any).body,
          ip_address: req.ip || '',
          user_agent: req.headers['user-agent'],
          session_id: (req as any).sessionID,
        }).catch(console.error);
      }
      
      return originalSend(body);
    };
    
    next();
  };
}

// ===========================================
// API Routes
// ===========================================

app.post('/api/audit', async (req: Request, res: Response) => {
  try {
    const entry = await auditLogger.log(req.body);
    res.status(201).json({ success: true, data: entry });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to create audit entry' });
  }
});

app.get('/api/audit', async (req: Request, res: Response) => {
  try {
    const entries = await auditQuery.search(req.query as any);
    res.json({ success: true, data: entries });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch audit logs' });
  }
});

app.get('/api/audit/entity/:type/:id', async (req: Request, res: Response) => {
  try {
    const entries = await auditQuery.getByEntity(req.params.type as AuditEntity, req.params.id);
    res.json({ success: true, data: entries });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch entity history' });
  }
});

app.get('/api/audit/user/:id', async (req: Request, res: Response) => {
  try {
    const entries = await auditQuery.getByUser(req.params.id);
    res.json({ success: true, data: entries });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch user activity' });
  }
});

app.get('/api/compliance/report', async (req: Request, res: Response) => {
  try {
    const { from, to } = req.query;
    const report = await generateComplianceReport(from as string, to as string);
    res.json({ success: true, data: report });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to generate report' });
  }
});

app.get('/api/compliance/anomalies', async (req: Request, res: Response) => {
  try {
    const anomalies = await detectAnomalies();
    res.json({ success: true, data: anomalies });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to detect anomalies' });
  }
});

app.get('/health', async (req: Request, res: Response) => {
  res.json({ status: 'healthy', service: 'audit-trails' });
});

const PORT = process.env.PORT || 3083;

app.listen(PORT, () => console.log(`Audit Trails Service on port ${PORT}`));

export default app;