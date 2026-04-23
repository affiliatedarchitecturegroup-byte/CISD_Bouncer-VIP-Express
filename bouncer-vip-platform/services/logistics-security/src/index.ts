// Logistics Security Service
import express from 'express';
import { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';
const app = express();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
app.use(express.json());

async function trackShipment(data: { id: string; origin: string; destination: string }) {
  await pool.query('INSERT INTO shipments (id, origin, destination, status, last_update) VALUES ($1, $2, $3, $4, NOW())', [data.id, data.origin, data.destination, 'in_transit']);
  return { id: data.id, ...data, status: 'in_transit' };
}

async function updateStatus(shipmentId: string, status: string, location: string) {
  await pool.query('UPDATE shipments SET status = $1, location = $2, last_update = NOW() WHERE id = $3', [status, location, shipmentId]);
  return { success: true };
}

async function logCheckpoint(data: { shipment_id: string; location: string; status: string }) {
  const id = uuidv4();
  await pool.query('INSERT INTO shipment_checkpoints (id, shipment_id, location, status, timestamp) VALUES ($1, $2, $3, $4, NOW())', [id, data.shipment_id, data.location, data.status]);
  return { id, ...data };
}

app.post('/api/shipments', async (req, res) => { const s = await trackShipment(req.body); res.json({ success: true, data: s }); });
app.put('/api/shipments/:id/status', async (req, res) => { await updateStatus(req.params.id, req.body.status, req.body.location); res.json({ success: true }); });
app.post('/api/checkpoints', async (req, res) => { const c = await logCheckpoint(req.body); res.json({ success: true, data: c }); });
app.get('/health', (req, res) => res.json({ status: 'healthy', service: 'logistics-security' }));

const PORT = process.env.PORT || 3162;
app.listen(PORT, () => console.log(`Logistics Security Service on port ${PORT}`));
export default app;