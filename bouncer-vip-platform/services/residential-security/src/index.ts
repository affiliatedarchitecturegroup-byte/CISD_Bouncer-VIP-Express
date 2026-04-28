// Residential Security Service
import express from 'express';
import { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';
const app = express();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
app.use(express.json());

async function registerProperty(data: { address: string; type: string; value: number; residents: number }) {
  const id = uuidv4();
  await pool.query('INSERT INTO residential_properties (id, address, type, value, residents, status) VALUES ($1, $2, $3, $4, $5, $6)', [id, data.address, data.type, data.value, data.residents, 'active']);
  return { id, ...data };
}

async function getGuardShifts(propertyId: string) {
  const result = await pool.query('SELECT * FROM residential_shifts WHERE property_id = $1 ORDER BY start_time', [propertyId]);
  return result.rows;
}

async function logVisitor(data: { property_id: string; name: string; purpose: string }) {
  const id = uuidv4();
  await pool.query('INSERT INTO residential_visitors (id, property_id, name, purpose, check_in) VALUES ($1, $2, $3, $4, NOW())', [id, data.property_id, data.name, data.purpose]);
  return { id, ...data };
}

async function alert(data: { property_id: string; type: string; severity: string }) {
  const id = uuidv4();
  await pool.query('INSERT INTO residential_alerts (id, property_id, type, severity, timestamp) VALUES ($1, $2, $3, $4, NOW())', [id, data.property_id, data.type, data.severity]);
  return { id, ...data };
}

app.post('/api/properties', async (req, res) => { const p = await registerProperty(req.body); res.json({ success: true, data: p }); });
app.get('/api/shifts/:propertyId', async (req, res) => { const s = await getGuardShifts(req.params.propertyId); res.json({ success: true, data: s }); });
app.post('/api/visitors', async (req, res) => { const v = await logVisitor(req.body); res.json({ success: true, data: v }); });
app.post('/api/alerts', async (req, res) => { const a = await alert(req.body); res.json({ success: true, data: a }); });
app.get('/health', (req, res) => res.json({ status: 'healthy', service: 'residential-security' }));

const PORT = process.env.PORT || 3150;
app.listen(PORT, () => console.log(`Residential Security Service on port ${PORT}`));
export default app;