// ===========================================
// Dashboard Real-time Service
// Phase 3.1 - WebSocket, live streaming
// ===========================================

import express from 'express';
import { Server } from 'http';
import { Pool } from 'pg';

const app = express();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
app.use(express.json());

// ===========================================
// WebSocket Server
// ===========================================

interface WebSocketClient {
  id: string;
  userId: string;
  dashboard: string;
  connected: boolean;
  lastSeen: string;
}

// Store connected clients
const clients = new Map<string, WebSocketClient>();

// ===========================================
// Presence System
// ===========================================

interface PresenceEntry {
  dashboard: string;
  userId: string;
  userName: string;
  role: string;
  status: 'active' | 'idle' | 'away';
  lastSeen: string;
}

const presenceStore = new Map<string, PresenceEntry[]>();

function updatePresence(dashboard: string, userId: string, userName: string, role: string): void {
  const entries = presenceStore.get(dashboard) || [];
  const existing = entries.findIndex(e => e.userId === userId);
  
  const entry: PresenceEntry = {
    dashboard,
    userId,
    userName,
    role,
    status: 'active',
    lastSeen: new Date().toISOString(),
  };
  
  if (existing >= 0) {
    entries[existing] = entry;
  } else {
    entries.push(entry);
  }
  
  presenceStore.set(dashboard, entries);
  broadcastPresence(dashboard);
}

function broadcastPresence(dashboard: string): void {
  const entries = presenceStore.get(dashboard) || [];
  // Broadcast to all clients on this dashboard
  for (const [, client] of clients) {
    if (client.dashboard === dashboard) {
      // Send presence update
    }
  }
}

function getDashboardPresence(dashboard: string): PresenceEntry[] {
  return presenceStore.get(dashboard) || [];
}

// ===========================================
// Live Data Streaming
// ===========================================

interface StreamConfig {
  table: string;
  filter?: string;
  fields: string[];
}

const activeStreams = new Map<string, StreamConfig>();

function startStream(streamId: string, config: StreamConfig): void {
  activeStreams.set(streamId, config);
}

function stopStream(streamId: string): void {
  activeStreams.delete(streamId);
}

async function getStreamData(streamId: string): Promise<any[]> {
  const config = activeStreams.get(streamId);
  if (!config) return [];
  
  const fields = config.fields.join(', ');
  const sql = `SELECT ${fields} FROM ${config.table} ${config.filter ? 'WHERE ' + config.filter : ''}`;
  
  const result = await pool.query(sql);
  return result.rows;
}

// ===========================================
// Broadcast Events
// ===========================================

interface BroadcastEvent {
  type: string;
  data: any;
  dashboard?: string;
}

function broadcast(event: BroadcastEvent): void {
  for (const [id, client] of clients) {
    if (event.dashboard && client.dashboard !== event.dashboard) continue;
    // Send event to client
  }
}

// ===========================================
// Collaborative Locking
// ===========================================

interface Lock {
  resource: string;
  userId: string;
  dashboard: string;
  expires: string;
}

const locks = new Map<string, Lock>();

function acquireLock(resource: string, userId: string, dashboard: string): boolean {
  if (locks.has(resource)) return false;
  
  locks.set(resource, {
    resource,
    userId,
    dashboard,
    expires: new Date(Date.now() + 60000).toISOString(), // 1 minute
  });
  
  return true;
}

function releaseLock(resource: string, userId: string): boolean {
  const lock = locks.get(resource);
  if (!lock || lock.userId !== userId) return false;
  
  locks.delete(resource);
  return true;
}

function getLocks(dashboard: string): Lock[] {
  return Array.from(locks.values()).filter(l => l.dashboard === dashboard);
}

// ===========================================
// Activity Feed
// ===========================================

interface ActivityEntry {
  id: string;
  dashboard: string;
  userId: string;
  action: string;
  resource: string;
  timestamp: string;
}

async function logActivity(entry: Omit<ActivityEntry, 'id' | 'timestamp'>): Promise<void> {
  await pool.query(`
    INSERT INTO dashboard_activity (dashboard, user_id, action, resource, timestamp)
    VALUES ($1, $2, $3, $4, NOW())
  `, [entry.dashboard, entry.userId, entry.action, entry.resource]);
}

async function getActivity(dashboard: string, limit: number = 50): Promise<ActivityEntry[]> {
  const result = await pool.query(`
    SELECT * FROM dashboard_activity
    WHERE dashboard = $1
    ORDER BY timestamp DESC
    LIMIT $2
  `, [dashboard, limit]);
  
  return result.rows;
}

// API Routes
app.post('/api/presence', (req: Request, res: Response) => {
  const { dashboard, user_id, user_name, role } = req.body;
  updatePresence(dashboard, user_id, user_name, role);
  res.json({ success: true });
});

app.get('/api/presence/:dashboard', (req: Request, res: Response) => {
  const presence = getDashboardPresence(req.params.dashboard);
  res.json({ success: true, data: presence });
});

app.post('/api/streams', (req: Request, res: Response) => {
  const { stream_id, config } = req.body;
  startStream(stream_id, config);
  res.json({ success: true });
});

app.delete('/api/streams/:id', (req: Request, res: Response) => {
  stopStream(req.params.id);
  res.json({ success: true });
});

app.get('/api/streams/:id', async (req: Request, res: Response) => {
  const data = await getStreamData(req.params.id);
  res.json({ success: true, data });
});

app.post('/api/locks', (req: Request, res: Response) => {
  const { resource, user_id, dashboard } = req.body;
  const acquired = acquireLock(resource, user_id, dashboard);
  res.json({ success: acquired });
});

app.delete('/api/locks/:resource', (req: Request, res: Response) => {
  const { user_id } = req.query;
  const released = releaseLock(req.params.resource, user_id as string);
  res.json({ success: released });
});

app.get('/api/locks/:dashboard', (req: Request, res: Response) => {
  const locks = getLocks(req.params.dashboard);
  res.json({ success: true, data: locks });
});

app.post('/api/activity', async (req: Request, res: Response) => {
  await logActivity(req.body);
  res.json({ success: true });
});

app.get('/api/activity/:dashboard', async (req: Request, res: Response) => {
  const activity = await getActivity(req.params.dashboard);
  res.json({ success: true, data: activity });
});

app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'healthy', service: 'dashboard-realtime' });
});

const PORT = process.env.PORT || 3300;
const server = app.listen(PORT, () => console.log(`Dashboard Real-time Service on port ${PORT}`));

export default app;