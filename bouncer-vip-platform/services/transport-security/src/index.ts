// Transport Security Service
import express from 'express';
import { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';
const app = express();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
app.use(express.json());

async function trackVehicle(data: { vehicle_id: string; type: string; route: string }) {
  const id = uuidv4();
  await pool.query('INSERT INTO transport_tracking (id, vehicle_id, type, route, last_update) VALUES ($1, $2, $3, $4, NOW())', [id, data.vehicle_id, data.type, data.route]);
  return { id, ...data, last_update: new Date().toISOString() };
}

async function getLocation(vehicleId: string) {
  const result = await pool.query('SELECT * FROM transport_tracking WHERE vehicle_id = $1', [vehicleId]);
  return result.rows[0];
}

async function logIncident(data: { vehicle_id: string; type: string; description: string }) {
  const id = uuidv4();
  await pool.query('INSERT INTO transport_incidents (id, vehicle_id, type, description, timestamp) VALUES ($1, $2, $3, $4, NOW())', [id, data.vehicle_id, data.type, data.description]);
  return { id, ...data };
}

app.post('/api/track', async (req, res) => { const t = await trackVehicle(req.body); res.json({ success: true, data: t }); });
app.get('/api/track/:vehicleId', async (req, res) => { const l = await getLocation(req.params.vehicleId); res.json({ success: true, data: l }); });
app.post('/api/incidents', async (req, res) => { const i = await logIncident(req.body); res.json({ success: true, data: i }); });
app.get('/health', (req, res) => res.json({ status: 'healthy', service: 'transport-security' }));

const PORT = process.env.PORT || 3151;
app.listen(PORT, () => console.log(`Transport Security Service on port ${PORT}`));
export default app;