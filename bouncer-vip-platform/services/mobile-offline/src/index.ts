// ===========================================
// Mobile Offline Support Service
// Phase 2.1 - Offline data sync
// ===========================================

import express, { Request, Response } from 'express';
import { Pool } from 'pg';
import Redis from 'ioredis';
import { v4 as uuidv4 } from 'uuid';

const app = express();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

app.use(express.json());

// ===========================================
// Local Storage Types
// ===========================================

interface LocalEntity {
  id: string;
  type: string;
  data: any;
  version: number;
  created_at: string;
  updated_at: string;
  pending: boolean;
}

interface SyncQueueItem {
  id: string;
  entity_type: string;
  entity_id: string;
  operation: 'create' | 'update' | 'delete';
  data: any;
  timestamp: string;
  retries: number;
  status: 'pending' | 'processing' | 'failed';
}

interface ConflictResolution {
  entity_type: string;
  entity_id: string;
  server_version: any;
  local_version: any;
  resolved: boolean;
  resolution: 'server' | 'local' | 'merge';
}

// ===========================================
// Offline Storage
// ===========================================

async function storeLocally(userId: string, entity: LocalEntity): Promise<void> {
  const key = `offline:${userId}:${entity.type}:${entity.id}`;
  await redis.setex(key, 86400 * 7, JSON.stringify(entity)); // 7 day TTL
  
  // Also track in user's offline index
  await redis.sadd(`offline_index:${userId}:${entity.type}`, entity.id);
}

async function getLocalEntities(userId: string, type: string): Promise<LocalEntity[]> {
  const ids = await redis.smembers(`offline_index:${userId}:${type}`);
  const entities: LocalEntity[] = [];
  
  for (const id of ids) {
    const data = await redis.get(`offline:${userId}:${type}:${id}`);
    if (data) entities.push(JSON.parse(data));
  }
  
  return entities;
}

async function deleteLocalEntity(userId: string, type: string, id: string): Promise<void> {
  await redis.del(`offline:${userId}:${type}:${id}`);
  await redis.srem(`offline_index:${userId}:${type}`, id);
}

// ===========================================
// Sync Queue
// ===========================================

async function queueForSync(item: Omit<SyncQueueItem, 'id' | 'timestamp' | 'status'>): Promise<void> {
  const id = uuidv4();
  const fullItem: SyncQueueItem = {
    id,
    ...item,
    timestamp: new Date().toISOString(),
    status: 'pending',
  };
  
  await redis.lpush(`sync_queue:${item.entity_type}`, JSON.stringify(fullItem));
}

async function getSyncQueue(entityType: string, limit: number = 10): Promise<SyncQueueItem[]> {
  const items = await redis.lrange(`sync_queue:${entityType}`, 0, limit - 1);
  return items.map(i => JSON.parse(i));
}

async function markSyncComplete(itemId: string, entityType: string): Promise<void> {
  // Remove from queue
  const items = await redis.lrange(`sync_queue:${entityType}`, 0, -1);
  const newItems = items.filter(i => JSON.parse(i).id !== itemId);
  await redis.del(`sync_queue:${entityType}`);
  if (newItems.length > 0) {
    await redis.rpush(`sync_queue:${entityType}`, ...newItems);
  }
}

async function markSyncFailed(itemId: string, entityType: string): Promise<void> {
  const items = await redis.lrange(`sync_queue:${entityType}`, 0, -1);
  
  for (let i = 0; i < items.length; i++) {
    const item = JSON.parse(items[i]);
    if (item.id === itemId) {
      item.retries++;
      item.status = item.retries >= 3 ? 'failed' : 'pending';
      item.timestamp = new Date().toISOString();
      items[i] = JSON.stringify(item);
      break;
    }
  }
  
  await redis.del(`sync_queue:${entityType}`);
  if (items.length > 0) {
    await redis.rpush(`sync_queue:${entityType}`, ...items);
  }
}

// ===========================================
// Conflict Resolution
// ===========================================

async function detectConflict(
  entityType: string, 
  entityId: string, 
  clientVersion: number
): Promise<ConflictResolution | null> {
  // Check server version
  const result = await pool.query(
    `SELECT * FROM ${entityType} WHERE id = $1`,
    [entityId]
  );
  
  if (result.rows.length === 0) return null;
  
  const serverVersion = result.rows[0].version || 0;
  
  if (serverVersion > clientVersion) {
    return {
      entity_type: entityType,
      entity_id: entityId,
      server_version: result.rows[0],
      local_version: null,
      resolved: false,
      resolution: 'server',
    };
  }
  
  return null;
}

async function resolveConflict(resolution: ConflictResolution): Promise<void> {
  if (resolution.resolution === 'server') {
    // Keep server version - no action needed
  } else if (resolution.resolution === 'local') {
    // Overwrite with local version
    await pool.query(
      `UPDATE ${resolution.entity_type} SET data = $1, version = version + 1 WHERE id = $2`,
      [JSON.stringify(resolution.local_version), resolution.entity_id]
    );
  } else if (resolution.resolution === 'merge') {
    // Custom merge logic here
  }
  
  // Mark as resolved
  await redis.del(`conflict:${resolution.entity_type}:${resolution.entity_id}`);
}

// ===========================================
// Sync Processor
// ===========================================

async function processSync(entityType: string): Promise<{
  processed: number;
  failed: number;
}> {
  const queue = await getSyncQueue(entityType, 10);
  let processed = 0, failed = 0;
  
  for (const item of queue) {
    if (item.status !== 'pending') continue;
    
    try {
      await redis.set(`sync:processing:${item.id}`, '1');
      
      // Process based on operation
      if (item.operation === 'create') {
        await pool.query(
          `INSERT INTO ${entityType} (id, data, version) VALUES ($1, $2, 1)`,
          [item.entity_id, JSON.stringify(item.data)]
        );
      } else if (item.operation === 'update') {
        await pool.query(
          `UPDATE ${entityType} SET data = $1, version = version + 1 WHERE id = $2`,
          [JSON.stringify(item.data), item.entity_id]
        );
      } else if (item.operation === 'delete') {
        await pool.query(`DELETE FROM ${entityType} WHERE id = $1`, [item.entity_id]);
      }
      
      await markSyncComplete(item.id, entityType);
      await redis.del(`sync:processing:${item.id}`);
      processed++;
    } catch (error) {
      await markSyncFailed(item.id, entityType);
      failed++;
    }
  }
  
  return { processed, failed };
}

// Run sync processor every 30 seconds
setInterval(() => {
  processSync('bookings').catch(console.error);
  processSync('incidents').catch(console.error);
}, 30000);

// ===========================================
// API Routes
// ===========================================

app.post('/api/offline/store', async (req: Request, res: Response) => {
  const { user_id, entity } = req.body;
  await storeLocally(user_id, entity);
  res.json({ success: true });
});

app.get('/api/offline/:userId/:type', async (req: Request, res: Response) => {
  const entities = await getLocalEntities(req.params.userId, req.params.type);
  res.json({ success: true, data: entities });
});

app.post('/api/offline/delete', async (req: Request, res: Response) => {
  const { user_id, type, id } = req.body;
  await deleteLocalEntity(user_id, type, id);
  res.json({ success: true });
});

app.post('/api/sync/queue', async (req: Request, res: Response) => {
  const item = req.body;
  await queueForSync(item);
  res.json({ success: true });
});

app.get('/api/sync/queue/:type', async (req: Request, res: Response) => {
  const queue = await getSyncQueue(req.params.type);
  res.json({ success: true, data: queue });
});

app.post('/api/sync/process/:type', async (req: Request, res: Response) => {
  const result = await processSync(req.params.type);
  res.json({ success: true, data: result });
});

app.post('/api/conflict/resolve', async (req: Request, res: Response) => {
  await resolveConflict(req.body);
  res.json({ success: true });
});

app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'healthy', service: 'mobile-offline' });
});

const PORT = process.env.PORT || 3200;
app.listen(PORT, () => console.log(`Mobile Offline Service on port ${PORT}`));

export default app;