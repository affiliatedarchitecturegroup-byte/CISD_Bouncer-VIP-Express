// Industrial Security Service
import express from 'express';
import { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';
const app = express();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
app.use(express.json());

async function registerFacility(data: { name: string; type: string; workers: number }) {
  const id = uuidv4();
  await pool.query('INSERT INTO industrial_facilities (id, name, type, workers, status) VALUES ($1, $2, $3, $4, $5)', [id, data.name, data.type, data.workers, 'active']);
  return { id, ...data };
}

async function safetyReport(data: { facility_id: string; type: string; severity: string }) {
  const id = uuidv4();
  await pool.query('INSERT INTO industrial_safety (id, facility_id, type, severity, reported_at) VALUES ($1, $2, $3, $4, NOW())', [id, data.facility_id, data.type, data.severity]);
  return { id, ...data };
}

async function accessLog(data: { facility_id: string; zone: string; person: string }) {
  await pool.query('INSERT INTO industrial_access (id, facility_id, zone, person, timestamp) VALUES ($1, $2, $3, $4, NOW())', [uuidv4(), data.facility_id, data.zone, data.person]);
  return { success: true };
}

app.post('/api/facilities', async (req, res) => { const f = await registerFacility(req.body); res.json({ success: true, data: f }); });
app.post('/api/safety', async (req, res) => { const s = await safetyReport(req.body); res.json({ success: true, data: s }); });
app.post('/api/access', async (req, res) => { await accessLog(req.body); res.json({ success: true }); });
app.get('/health', (req, res) => res.json({ status: 'healthy', service: 'industrial-security' }));

const PORT = process.env.PORT || 3161;
app.listen(PORT, () => console.log(`Industrial Security Service on port ${PORT}`));
export default app;