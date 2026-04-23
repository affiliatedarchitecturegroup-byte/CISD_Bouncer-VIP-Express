// Maritime Security Service
import express from 'express';
import { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';
const app = express();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
app.use(express.json());

async function registerPort(data: { name: string; location: string; capacity: number }) {
  const id = uuidv4();
  await pool.query('INSERT INTO maritime_ports (id, name, location, capacity, status) VALUES ($1, $2, $3, $4, $5)', [id, data.name, data.location, data.capacity, 'active']);
  return { id, ...data };
}

async function trackVessel(data: { vessel_id: string; port_id: string; status: string }) {
  const id = uuidv4();
  await pool.query('INSERT INTO vessel_tracking (id, vessel_id, port_id, status, last_update) VALUES ($1, $2, $3, $4, NOW())', [id, data.vessel_id, data.port_id, data.status]);
  return { id, ...data };
}

async function cargoScan(data: { vessel_id: string; containers: number; status: string }) {
  const id = uuidv4();
  await pool.query('INSERT INTO cargo_scans (id, vessel_id, containers, status, scanned_at) VALUES ($1, $2, $3, $4, NOW())', [id, data.vessel_id, data.containers, data.status]);
  return { id, ...data };
}

app.post('/api/ports', async (req, res) => { const p = await registerPort(req.body); res.json({ success: true, data: p }); });
app.post('/api/vessels', async (req, res) => { const v = await trackVessel(req.body); res.json({ success: true, data: v }); });
app.post('/api/cargo', async (req, res) => { const c = await cargoScan(req.body); res.json({ success: true, data: c }); });
app.get('/health', (req, res) => res.json({ status: 'healthy', service: 'maritime-security' }));

const PORT = process.env.PORT || 3152;
app.listen(PORT, () => console.log(`Maritime Security Service on port ${PORT}`));
export default app;