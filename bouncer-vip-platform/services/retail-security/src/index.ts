// ===========================================
// Retail Security Service
// Loss prevention, inventory monitoring, shoplifting detection
// ===========================================

import express, { Request, Response } from 'express';
import { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';

const app = express();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
app.use(express.json());

// Types
interface RetailStore { id: string; name: string; address: string; size_sqft: number; risk_level: string; }
interface ShopliftingAlert { id: string; store_id: string; timestamp: string; severity: string; description: string; suspect_description?: string; items_value?: number; }
interface InventoryLoss { id: string; store_id: string; product_id: string; quantity_lost: number; value: number; cause: string; detected_at: string; }

// Retail-specific metrics
interface RetailMetrics { shrinkage_rate: number; top_theft_items: string[]; high_risk_areas: string[]; incidents_by_hour: number[]; }

// Loss Prevention
class LossPrevention {
  async trackInventory(storeId: string): Promise<InventoryLoss[]> {
    const result = await pool.query(`
      SELECT * FROM inventory_losses WHERE store_id = $1 ORDER BY detected_at DESC
    `, [storeId]);
    return result.rows;
  }

  async analyzeShrinkage(storeId: string): Promise<RetailMetrics> {
    const [totalValue, byItem, byHour] = await Promise.all([
      pool.query(`SELECT SUM(value) as total FROM inventory_losses WHERE store_id = $1`, [storeId]),
      pool.query(`SELECT product_name, SUM(value) as value FROM inventory_losses WHERE store_id = $1 GROUP BY product_name ORDER BY value DESC LIMIT 10`, [storeId]),
      pool.query(`SELECT EXTRACT(HOUR FROM detected_at) as hour, COUNT(*) as count FROM inventory_losses WHERE store_id = $1 GROUP BY hour`, [storeId]),
    ]);

    return {
      shrinkage_rate: parseFloat(totalValue.rows[0]?.total || '0') / 1000000,
      top_theft_items: byItem.rows.map(r => r.product_name),
      high_risk_areas: ['Entrance', 'Fitting Rooms', 'High Shelves', 'Checkout'],
      incidents_by_hour: Array(24).fill(0).map((_, i) => byHour.rows.find(h => parseInt(h.hour) === i)?.count || 0),
    };
  }

  async createShopliftingAlert(storeId: string, data: { severity: string; description: string; suspect?: string; items_value?: number }): Promise<ShopliftingAlert> {
    const id = uuidv4();
    await pool.query(`
      INSERT INTO shoplifting_alerts (id, store_id, severity, description, suspect_description, items_value, timestamp)
      VALUES ($1, $2, $3, $4, $5, $6, NOW())
    `, [id, storeId, data.severity, data.description, data.suspect, data.items_value]);
    return { id, store_id: storeId, timestamp: new Date().toISOString(), ...data } as ShopliftingAlert;
  }
}

// Point of Sale Monitoring
class POSMonitoring {
  async detectAnomalies(storeId: string): Promise<any[]> {
    const result = await pool.query(`
      SELECT * FROM pos_transactions 
      WHERE store_id = $1 
        AND (quantity > 50 OR amount < 100 OR discount > 0.5)
        AND created_at > NOW() - INTERVAL '24 hours'
    `, [storeId]);
    return result.rows;
  }

  async getVoidReasons(storeId: string): Promise<Record<string, number>> {
    const result = await pool.query(`
      SELECT void_reason, COUNT(*) as count FROM pos_voids 
      WHERE store_id = $1 AND created_at > NOW() - INTERVAL '30 days'
      GROUP BY void_reason
    `, [storeId]);
    return Object.fromEntries(result.rows.map(r => [r.void_reason, parseInt(r.count)]));
  }
}

// Electronic Article Surveillance
class EASService {
  async getAlarmEvents(storeId: string): Promise<any[]> {
    const result = await pool.query(`
      SELECT * FROM eas_alarms WHERE store_id = $1 ORDER BY timestamp DESC LIMIT 100
    `, [storeId]);
    return result.rows;
  }

  async registerTag(productId: string, tagId: string): Promise<void> {
    await pool.query(`INSERT INTO eas_tags (id, product_id, tag_id, status) VALUES ($1, $2, $3, 'active')`, [uuidv4(), productId, tagId]);
  }

  async deactivateTag(tagId: string): Promise<void> {
    await pool.query(`UPDATE eas_tags SET status = 'deactivated' WHERE tag_id = $1`, [tagId]);
  }
}

// Store Performance
async function getStorePerformance(storeId: string): Promise<any> {
  const [security, losses, incidents] = await Promise.all([
    pool.query(`SELECT COUNT(*) as count FROM security_incidents WHERE store_id = $1 AND created_at > NOW() - INTERVAL '30 days'`, [storeId]),
    pool.query(`SELECT SUM(value) as total FROM inventory_losses WHERE store_id = $1 AND detected_at > NOW() - INTERVAL '30 days'`, [storeId]),
    pool.query(`SELECT COUNT(*) as count FROM shoplifting_alerts WHERE store_id = $1 AND timestamp > NOW() - INTERVAL '30 days'`, [storeId]),
  ]);
  return { security_incidents: parseInt(security.rows[0]?.count || '0'), inventory_losses: parseFloat(losses.rows[0]?.total || '0'), shoplifting_incidents: parseInt(incidents.rows[0]?.count || '0') };
}

// API Routes
app.post('/api/alerts/shoplifting', async (req, res) => {
  const lp = new LossPrevention();
  const alert = await lp.createShopliftingAlert(req.body.store_id, req.body);
  res.json({ success: true, data: alert });
});

app.get('/api/metrics/shrinkage/:storeId', async (req, res) => {
  const lp = new LossPrevention();
  const metrics = await lp.analyzeShrinkage(req.params.storeId);
  res.json({ success: true, data: metrics });
});

app.get('/api/pos/anomalies/:storeId', async (req, res) => {
  const pos = new POSMonitoring();
  const anomalies = await pos.detectAnomalies(req.params.storeId);
  res.json({ success: true, data: anomalies });
});

app.get('/api/eas/alarms/:storeId', async (req, res) => {
  const eas = new EASService();
  const events = await eas.getAlarmEvents(req.params.storeId);
  res.json({ success: true, data: events });
});

app.get('/api/store/performance/:storeId', async (req, res) => {
  const performance = await getStorePerformance(req.params.storeId);
  res.json({ success: true, data: performance });
});

app.get('/health', (req, res) => res.json({ status: 'healthy', service: 'retail-security' }));

const PORT = process.env.PORT || 3110;
app.listen(PORT, () => console.log(`Retail Security Service on port ${PORT}`));

export default app;