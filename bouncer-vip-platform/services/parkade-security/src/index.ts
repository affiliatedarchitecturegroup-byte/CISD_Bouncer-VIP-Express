// Parkade Security Service
import express from 'express';
import { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';
const app = express();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
app.use(express.json());

async function registerParkade(data: { name: string; capacity: number; levels: number }) {
  const id = uuidv4();
  await pool.query('INSERT INTO parkades (id, name, capacity, levels, status) VALUES ($1, $2, $3, $4, $5)', [id, data.name, data.capacity, data.levels, 'active']);
  return { id, ...data };
}

async function trackVehicle(data: { parkade_id: string; plate: string; entry_time: string }) {
  const id = uuidv4();
  await pool.query('INSERT INTO parkade_vehicles (id, parkade_id, plate, entry_time) VALUES ($1, $2, $3, $4)', [id, data.parkade_id, data.plate, data.entry_time]);
  return { id, ...data };
}

async function incident(data: { parkade_id: string; type: string; description: string }) {
  const id = uuidv4();
  await pool.query('INSERT INTO parkade_incidents (id, parkade_id, type, description, timestamp) VALUES ($1, $2, $3, $4, NOW())', [id, data.parkade_id, data.type, data.description]);
  return { id, ...data };
}

app.post('/api/parkades', async (req, res) => { const p = await registerParkade(req.body); res.json({ success: true, data: p }); });
app.post('/api/vehicles', async (req, res) => { const v = await trackVehicle(req.body); res.json({ success: true, data: v }); });
app.post('/api/incidents', async (req, res) => { const i = await incident(req.body); res.json({ success: true, data: i }); });
app.get('/health', (req, res) => res.json({ status: 'healthy', service: 'parkade-security' }));

const PORT = process.env.PORT || 3160;
app.listen(PORT, () => console.log(`Parkade Security Service on port ${PORT}`));
export default app;