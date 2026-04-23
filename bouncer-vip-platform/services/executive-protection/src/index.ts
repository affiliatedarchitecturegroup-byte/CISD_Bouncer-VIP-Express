// Executive Protection Service
import express from 'express';
import { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';
const app = express();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
app.use(express.json());

async function createProtectionPlan(data: { principal: string; level: string; duration: string }) {
  const id = uuidv4();
  await pool.query('INSERT INTO protection_plans (id, principal, level, duration, status) VALUES ($1, $2, $3, $4, $5)', [id, data.principal, data.level, data.duration, 'active']);
  return { id, ...data };
}

async function assignGuard(data: { plan_id: string; guard_id: string; zone: string }) {
  const id = uuidv4();
  await pool.query('INSERT INTO protection_guards (id, plan_id, guard_id, zone, assigned_at) VALUES ($1, $2, $3, $4, NOW())', [id, data.plan_id, data.guard_id, data.zone]);
  return { id, ...data };
}

async function routePlanning(data: { plan_id: string; waypoints: string[] }) {
  const id = uuidv4();
  await pool.query('INSERT INTO protection_routes (id, plan_id, waypoints, created_at) VALUES ($1, $2, $3, NOW())', [id, data.plan_id, JSON.stringify(data.waypoints)]);
  return { id, ...data };
}

app.post('/api/plans', async (req, res) => { const p = await createProtectionPlan(req.body); res.json({ success: true, data: p }); });
app.post('/api/guards', async (req, res) => { const g = await assignGuard(req.body); res.json({ success: true, data: g }); });
app.post('/api/routes', async (req, res) => { const r = await routePlanning(req.body); res.json({ success: true, data: r }); });
app.get('/health', (req, res) => res.json({ status: 'healthy', service: 'executive-protection' }));

const PORT = process.env.PORT || 3154;
app.listen(PORT, () => console.log(`Executive Protection Service on port ${PORT}`));
export default app;