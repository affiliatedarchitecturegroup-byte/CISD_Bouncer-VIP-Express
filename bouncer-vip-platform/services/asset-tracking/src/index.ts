// Asset Tracking Service
import express from 'express';
import { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';
const app = express();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
app.use(express.json());

async function registerAsset(data: { name: string; type: string; value: number; location: string }) {
  const id = uuidv4();
  await pool.query('INSERT INTO assets (id, name, type, value, location, status) VALUES ($1, $2, $3, $4, $5, $6)', [id, data.name, data.type, data.value, data.location, 'active']);
  return { id, ...data };
}

async function updateLocation(assetId: string, location: string) {
  await pool.query('UPDATE assets SET location = $1, last_update = NOW() WHERE id = $2', [location, assetId]);
}

async function getAssetHistory(assetId: string) {
  const result = await pool.query('SELECT * FROM asset_history WHERE asset_id = $1 ORDER BY timestamp DESC', [assetId]);
  return result.rows;
}

async function alert(data: { asset_id: string; type: string; severity: string }) {
  const id = uuidv4();
  await pool.query('INSERT INTO asset_alerts (id, asset_id, type, severity, timestamp) VALUES ($1, $2, $3, $4, NOW())', [id, data.asset_id, data.type, data.severity]);
  return { id, ...data };
}

app.post('/api/assets', async (req, res) => { const a = await registerAsset(req.body); res.json({ success: true, data: a }); });
app.put('/api/assets/:id/location', async (req, res) => { await updateLocation(req.params.id, req.body.location); res.json({ success: true }); });
app.get('/api/assets/:id/history', async (req, res) => { const h = await getAssetHistory(req.params.id); res.json({ success: true, data: h }); });
app.post('/api/alerts', async (req, res) => { const a = await alert(req.body); res.json({ success: true, data: a }); });
app.get('/health', (req, res) => res.json({ status: 'healthy', service: 'asset-tracking' }));

const PORT = process.env.PORT || 3155;
app.listen(PORT, () => console.log(`Asset Tracking Service on port ${PORT}`));
export default app;