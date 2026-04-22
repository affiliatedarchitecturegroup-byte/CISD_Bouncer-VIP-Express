// ===========================================
// Asset Management Service
// Equipment tracking, maintenance & inventory
// ===========================================

import express, { Request, Response } from 'express';
import { Pool } from 'pg';
import Redis from 'ioredis';
import { v4 as uuidv4 } from 'uuid';

const app = express();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const redis = new Redis(process.env.REDIS_URL);

app.use(express.json());

// ===========================================
// Asset Types
// ===========================================

type AssetCategory = 'uniform' | 'equipment' | 'vehicle' | 'communication' | 'weapon' | 'other';
type AssetStatus = 'available' | 'assigned' | 'maintenance' | 'lost' | 'retired';
type MaintenanceType = 'preventive' | 'corrective' | 'inspection' | 'calibration';

interface Asset {
  id: string;
  category: AssetCategory;
  name: string;
  description: string;
  serial_number?: string;
  purchase_date?: string;
  purchase_price?: number;
  current_value?: number;
  status: AssetStatus;
  assigned_to?: string;
  location_id?: string;
  condition: 'new' | 'good' | 'fair' | 'poor' | 'damaged';
  last_maintenance?: string;
  next_maintenance?: string;
}

interface MaintenanceRecord {
  id: string;
  asset_id: string;
  type: MaintenanceType;
  description: string;
  cost: number;
  performed_by: string;
  performed_at: string;
  notes?: string;
}

// ===========================================
// Asset CRUD
// ===========================================

async function createAsset(data: Partial<Asset>): Promise<Asset> {
  const id = uuidv4();
  const [asset] = await pool.query(`
    INSERT INTO assets (id, category, name, description, serial_number, purchase_date, 
                     purchase_price, status, condition, created_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, 'available', 'new', NOW())
    RETURNING *
  `, [id, data.category, data.name, data.description, data.serial_number, data.purchase_date, data.purchase_price]);
  
  return asset;
}

async function getAssets(filters?: { category?: string; status?: string; assigned_to?: string }): Promise<Asset[]> {
  let query = 'SELECT * FROM assets WHERE deleted_at IS NULL';
  const params: any[] = [];
  
  if (filters?.category) {
    params.push(filters.category);
    query += ` AND category = $${params.length}`;
  }
  if (filters?.status) {
    params.push(filters.status);
    query += ` AND status = $${params.length}`;
  }
  if (filters?.assigned_to) {
    params.push(filters.assigned_to);
    query += ` AND assigned_to = $${params.length}`;
  }
  
  query += ' ORDER BY created_at DESC';
  const result = await pool.query(query, params);
  return result.rows;
}

async function getAssetById(id: string): Promise<Asset | null> {
  const result = await pool.query('SELECT * FROM assets WHERE id = $1 AND deleted_at IS NULL', [id]);
  return result.rows[0] || null;
}

async function updateAsset(id: string, data: Partial<Asset>): Promise<Asset | null> {
  const updates: string[] = [];
  const params: any[] = [];
  
  if (data.status) { params.push(data.status); updates.push(`status = $${params.length}`); }
  if (data.condition) { params.push(data.condition); updates.push(`condition = $${params.length}`); }
  if (data.assigned_to !== undefined) { params.push(data.assigned_to); updates.push(`assigned_to = $${params.length}`); }
  
  if (updates.length === 0) return getAssetById(id);
  
  params.push(id);
  const result = await pool.query(`
    UPDATE assets SET ${updates.join(', ')}, updated_at = NOW()
    WHERE id = $${params.length} AND deleted_at IS NULL
    RETURNING *
  `, params);
  
  return result.rows[0] || null;
}

async function deleteAsset(id: string): Promise<boolean> {
  await pool.query('UPDATE assets SET deleted_at = NOW() WHERE id = $1', [id]);
  return true;
}

// ===========================================
// Assignment Management
// ===========================================

async function assignAsset(assetId: string, officerId: string, locationId: string): Promise<void> {
  await pool.query(`
    UPDATE assets SET assigned_to = $1, location_id = $2, status = 'assigned', updated_at = NOW()
    WHERE id = $3
  `, [officerId, locationId, assetId]);
  
  // Record assignment history
  await pool.query(`
    INSERT INTO asset_assignments (id, asset_id, officer_id, location_id, assigned_at)
    VALUES ($1, $2, $3, $4, NOW())
  `, [uuidv4(), assetId, officerId, locationId]);
  
  // Publish event
  await redis.publish('asset:assigned', JSON.stringify({ assetId, officerId, locationId }));
}

async function returnAsset(assetId: string): Promise<void> {
  await pool.query(`
    UPDATE assets SET assigned_to = NULL, location_id = NULL, status = 'available', updated_at = NOW()
    WHERE id = $1
  `, [assetId]);
  
  await redis.publish('asset:returned', JSON.stringify({ assetId }));
}

async function getAssignmentHistory(assetId: string): Promise<any[]> {
  const result = await pool.query(`
    SELECT ah.*, o.first_name, o.last_name, v.name as venue_name
    FROM asset_assignments ah
    LEFT JOIN officers o ON ah.officer_id = o.id
    LEFT JOIN venues v ON ah.location_id = v.id
    WHERE ah.asset_id = $1
    ORDER BY ah.assigned_at DESC
  `, [assetId]);
  return result.rows;
}

// ===========================================
// Maintenance Management
// ===========================================

async function scheduleMaintenance(
  assetId: string,
  type: MaintenanceType,
  scheduledDate: string,
  description: string
): Promise<void> {
  await pool.query(`
    INSERT INTO maintenance_schedules (id, asset_id, type, description, scheduled_date, status)
    VALUES ($1, $2, $3, $4, $5, 'scheduled')
  `, [uuidv4(), assetId, type, description, scheduledDate]);
  
  await pool.query(`
    UPDATE assets SET next_maintenance = $1, updated_at = NOW()
    WHERE id = $2
  `, [scheduledDate, assetId]);
}

async function completeMaintenance(
  assetId: string,
  data: { type: MaintenanceType; description: string; cost: number; performed_by: string; notes?: string; condition_after?: string }
): Promise<MaintenanceRecord> {
  const id = uuidv4();
  
  // Create maintenance record
  const result = await pool.query(`
    INSERT INTO maintenance_records (id, asset_id, type, description, cost, performed_by, performed_at, notes)
    VALUES ($1, $2, $3, $4, $5, $6, NOW(), $7)
    RETURNING *
  `, [id, assetId, data.type, data.description, data.cost, data.performed_by, data.notes]);
  
  // Update asset condition
  if (data.condition_after) {
    await pool.query('UPDATE assets SET condition = $1, last_maintenance = NOW(), updated_at = NOW() WHERE id = $2', [data.condition_after, assetId]);
  } else {
    await pool.query('UPDATE assets SET last_maintenance = NOW(), updated_at = NOW() WHERE id = $1', [assetId]);
  }
  
  // Mark schedule as completed
  await pool.query(`
    UPDATE maintenance_schedules SET status = 'completed', completed_at = NOW()
    WHERE asset_id = $1 AND status = 'scheduled'
  `, [assetId]);
  
  return result.rows[0];
}

async function getMaintenanceHistory(assetId: string): Promise<MaintenanceRecord[]> {
  const result = await pool.query(`
    SELECT mr.*, o.first_name, o.last_name
    FROM maintenance_records mr
    LEFT JOIN officers o ON mr.performed_by = o.id
    WHERE mr.asset_id = $1
    ORDER BY mr.performed_at DESC
  `, [assetId]);
  return result.rows;
}

async function getUpcomingMaintenance(): Promise<any[]> {
  const result = await pool.query(`
    SELECT ms.*, a.name as asset_name, a.serial_number, c.name as category_name
    FROM maintenance_schedules ms
    JOIN assets a ON ms.asset_id = a.id
    LEFT JOIN asset_categories c ON a.category = c.id
    WHERE ms.status = 'scheduled' AND ms.scheduled_date <= NOW() + INTERVAL '7 days'
    ORDER BY ms.scheduled_date ASC
  `);
  return result.rows;
}

// ===========================================
// Inventory & Stock
// ===========================================

interface InventoryItem {
  id: string;
  name: string;
  category: string;
  sku: string;
  quantity: number;
  min_quantity: number;
  max_quantity: number;
  unit_cost: number;
  supplier?: string;
}

async function updateStock(itemId: string, quantityChange: number, type: 'addition' | 'usage' | 'damage'): Promise<void> {
  await pool.query(`
    UPDATE inventory SET quantity = quantity + $1, updated_at = NOW()
    WHERE id = $2
  `, [quantityChange, itemId]);
  
  // Record transaction
  await pool.query(`
    INSERT INTO inventory_transactions (id, item_id, type, quantity, created_at)
    VALUES ($1, $2, $3, $4, NOW())
  `, [uuidv4(), itemId, type, Math.abs(quantityChange)]);
}

async function getLowStock(): Promise<InventoryItem[]> {
  const result = await pool.query(`
    SELECT * FROM inventory WHERE quantity <= min_quantity ORDER BY quantity ASC
  `);
  return result.rows;
}

// ===========================================
// Analytics
// ===========================================

async function getAssetAnalytics(): Promise<{
  total: number;
  by_status: Record<string, number>;
  by_category: Record<string, number>;
  total_value: number;
  maintenance_pending: number;
  assignments_this_month: number;
}> {
  const [totalResult, statusResult, categoryResult, valueResult] = await Promise.all([
    pool.query('SELECT COUNT(*) as count FROM assets WHERE deleted_at IS NULL'),
    pool.query('SELECT status, COUNT(*) as count FROM assets WHERE deleted_at IS NULL GROUP BY status'),
    pool.query('SELECT category, COUNT(*) as count FROM assets WHERE deleted_at IS NULL GROUP BY category'),
    pool.query('SELECT SUM(current_value) as total FROM assets WHERE deleted_at IS NULL'),
  ]);
  
  const [pendingMaintenance, assignmentsThisMonth] = await Promise.all([
    pool.query("SELECT COUNT(*) as count FROM maintenance_schedules WHERE status = 'scheduled'"),
    pool.query("SELECT COUNT(*) as count FROM asset_assignments WHERE assigned_at > NOW() - INTERVAL '30 days'"),
  ]);
  
  return {
    total: parseInt(totalResult.rows[0]?.count || '0'),
    by_status: Object.fromEntries(statusResult.rows.map(r => [r.status, parseInt(r.count)])),
    by_category: Object.fromEntries(categoryResult.rows.map(r => [r.category, parseInt(r.count)])),
    total_value: parseInt(valueResult.rows[0]?.total || '0'),
    maintenance_pending: parseInt(pendingMaintenance.rows[0]?.count || '0'),
    assignments_this_month: parseInt(assignmentsThisMonth.rows[0]?.count || '0'),
  };
}

// ===========================================
// API Routes
// ===========================================

// POST /api/assets - Create asset
app.post('/api/assets', async (req: Request, res: Response) => {
  try {
    const asset = await createAsset(req.body);
    res.status(201).json({ success: true, data: asset });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to create asset' });
  }
});

// GET /api/assets - List assets
app.get('/api/assets', async (req: Request, res: Response) => {
  try {
    const { category, status, assigned_to } = req.query as any;
    const assets = await getAssets({ category, status, assigned_to });
    res.json({ success: true, data: assets });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch assets' });
  }
});

// GET /api/assets/:id - Get asset
app.get('/api/assets/:id', async (req: Request, res: Response) => {
  try {
    const asset = await getAssetById(req.params.id);
    if (!asset) return res.status(404).json({ success: false, error: 'Asset not found' });
    res.json({ success: true, data: asset });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch asset' });
  }
});

// PUT /api/assets/:id - Update asset
app.put('/api/assets/:id', async (req: Request, res: Response) => {
  try {
    const asset = await updateAsset(req.params.id, req.body);
    if (!asset) return res.status(404).json({ success: false, error: 'Asset not found' });
    res.json({ success: true, data: asset });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to update asset' });
  }
});

// DELETE /api/assets/:id - Delete asset
app.delete('/api/assets/:id', async (req: Request, res: Response) => {
  try {
    await deleteAsset(req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to delete asset' });
  }
});

// POST /api/assets/:id/assign - Assign asset
app.post('/api/assets/:id/assign', async (req: Request, res: Response) => {
  try {
    const { officer_id, location_id } = req.body;
    await assignAsset(req.params.id, officer_id, location_id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to assign asset' });
  }
});

// POST /api/assets/:id/return - Return asset
app.post('/api/assets/:id/return', async (req: Request, res: Response) => {
  try {
    await returnAsset(req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to return asset' });
  }
});

// GET /api/assets/:id/history - Assignment history
app.get('/api/assets/:id/history', async (req: Request, res: Response) => {
  try {
    const history = await getAssignmentHistory(req.params.id);
    res.json({ success: true, data: history });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch history' });
  }
});

// GET /api/assets/:id/maintenance - Maintenance history
app.get('/api/assets/:id/maintenance', async (req: Request, res: Response) => {
  try {
    const history = await getMaintenanceHistory(req.params.id);
    res.json({ success: true, data: history });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch maintenance' });
  }
});

// POST /api/assets/:id/maintenance/complete - Complete maintenance
app.post('/api/assets/:id/maintenance/complete', async (req: Request, res: Response) => {
  try {
    const record = await completeMaintenance(req.params.id, req.body);
    res.json({ success: true, data: record });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to complete maintenance' });
  }
});

// GET /api/maintenance/upcoming - Upcoming maintenance
app.get('/api/maintenance/upcoming', async (req: Request, res: Response) => {
  try {
    const schedules = await getUpcomingMaintenance();
    res.json({ success: true, data: schedules });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch schedules' });
  }
});

// GET /api/inventory/low-stock - Low stock items
app.get('/api/inventory/low-stock', async (req: Request, res: Response) => {
  try {
    const items = await getLowStock();
    res.json({ success: true, data: items });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch items' });
  }
});

// GET /api/analytics - Asset analytics
app.get('/api/analytics', async (req: Request, res: Response) => {
  try {
    const analytics = await getAssetAnalytics();
    res.json({ success: true, data: analytics });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch analytics' });
  }
});

// GET /health
app.get('/health', async (req: Request, res: Response) => {
  res.json({ status: 'healthy', service: 'asset-management' });
});

const PORT = process.env.PORT || 3017;

async function start() {
  try {
    await pool.connect();
    await redis.connect();
    console.log('Asset Management: DB & Redis connected');
  } catch (error) {
    console.log('Asset Management: Starting in degraded mode');
  }
  app.listen(PORT, () => console.log(`Asset Management Service on port ${PORT}`));
}

start();

export default app;