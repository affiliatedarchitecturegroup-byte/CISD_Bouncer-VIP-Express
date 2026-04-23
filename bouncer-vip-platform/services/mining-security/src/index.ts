// ===========================================
// Mining Security Service
// Mine site security, hazard monitoring, equipment tracking
// ===========================================

import express, { Request, Response } from 'express';
import { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';

const app = express();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
app.use(express.json());

// Types
interface MineSite { id: string; name: string; location: string; depth: number; workers: number; risk_level: string; }
interface Equipment { id: string; name: string; type: string; serial_number: string; value: number; status: string; }
interface HazardAlert { id: string; mine_id: string; type: string; severity: string; description: string; location: string; timestamp: string; resolved: boolean; }

// Mine Site Management
async function registerMineSite(data: { name: string; location: string; depth: number; }): Promise<MineSite> {
  const id = uuidv4();
  await pool.query(`INSERT INTO mine_sites (id, name, location, depth, risk_level, status) VALUES ($1, $2, $3, $4, 'medium', 'active')`, [id, data.name, data.location, data.depth]);
  return { id, ...data, workers: 0, risk_level: 'medium' };
}

async function getMineSites(): Promise<MineSite[]> {
  const result = await pool.query('SELECT * FROM mine_sites');
  return result.rows;
}

// Equipment Tracking
async function registerEquipment(data: { name: string; type: string; serial_number: string; value: number; mine_id: string }): Promise<Equipment> {
  const id = uuidv4();
  await pool.query(`INSERT INTO mining_equipment (id, name, type, serial_number, value, mine_id, status) VALUES ($1, $2, $3, $4, $5, $6, 'active')`, [id, data.name, data.type, data.serial_number, data.value, data.mine_id]);
  return { id, ...data, status: 'active' };
}

async function trackEquipment(mineId: string): Promise<any[]> {
  const result = await pool.query('SELECT * FROM mining_equipment WHERE mine_id = $1', [mineId]);
  return result.rows;
}

// Hazard Monitoring
const HAZARD_TYPES = ['rock_fall', 'flooding', 'gas_leak', 'fire', 'equipment_failure', 'structural_collapse', 'vehicle_accident', 'electrical', 'chemical'];

async function createHazardAlert(data: { mine_id: string; type: string; severity: string; description: string; location: string }): Promise<HazardAlert> {
  const id = uuidv4();
  await pool.query(`INSERT INTO hazard_alerts (id, mine_id, type, severity, description, location, timestamp) VALUES ($1, $2, $3, $4, $5, $6, NOW())`, [id, data.mine_id, data.type, data.severity, data.description, data.location]);
  return { id, ...data, timestamp: new Date().toISOString(), resolved: false };
}

async function getActiveHazards(mineId: string): Promise<HazardAlert[]> {
  const result = await pool.query('SELECT * FROM hazard_alerts WHERE mine_id = $1 AND resolved = false ORDER BY timestamp DESC', [mineId]);
  return result.rows;
}

async function resolveHazard(alertId: string): Promise<void> {
  await pool.query('UPDATE hazard_alerts SET resolved = true, resolved_at = NOW() WHERE id = $1', [alertId]);
}

// Worker Safety
async function checkWorkerCount(mineId: string): Promise<{ total: number; surface: number; underground: number }> {
  const result = await pool.query('SELECT location_type, COUNT(*) as count FROM mine_workers WHERE mine_id = $1 GROUP BY location_type', [mineId]);
  const counts = Object.fromEntries(result.rows.map(r => [r.location_type, parseInt(r.count)]));
  return { total: counts.surface + counts.underground, surface: counts.surface || 0, underground: counts.underground || 0 };
}

async function triggerEmergency(mineId: string, type: string): Promise<void> {
  await pool.query('INSERT INTO emergency_protocols (id, mine_id, type, triggered_at) VALUES ($1, $2, $3, NOW())', [uuidv4(), mineId, type]);
  // Notify all workers
}

// Blast Monitoring
async function logBlast(mineId: string, data: { time: string; magnitude: number; location: string }): Promise<void> {
  await pool.query('INSERT INTO blast_logs (id, mine_id, time, magnitude, location) VALUES ($1, $2, $3, $4, $5)', [uuidv4(), mineId, data.time, data.magnitude, data.location]);
}

async function getBlastHistory(mineId: string): Promise<any[]> {
  const result = await pool.query('SELECT * FROM blast_logs WHERE mine_id = $1 ORDER BY time DESC LIMIT 100', [mineId]);
  return result.rows;
}

// API Routes
app.post('/api/mines', async (req, res) => { const mine = await registerMineSite(req.body); res.json({ success: true, data: mine }); });
app.get('/api/mines', async (req, res) => { const mines = await getMineSites(); res.json({ success: true, data: mines }); });
app.post('/api/equipment', async (req, res) => { const equipment = await registerEquipment(req.body); res.json({ success: true, data: equipment }); });
app.get('/api/equipment/:mineId', async (req, res) => { const equipment = await trackEquipment(req.params.mineId); res.json({ success: true, data: equipment }); });
app.post('/api/hazards', async (req, res) => { const hazard = await createHazardAlert(req.body); res.json({ success: true, data: hazard }); });
app.get('/api/hazards/:mineId', async (req, res) => { const hazards = await getActiveHazards(req.params.mineId); res.json({ success: true, data: hazards }); });
app.post('/api/hazards/:id/resolve', async (req, res) => { await resolveHazard(req.params.id); res.json({ success: true }); });
app.get('/api/workers/:mineId', async (req, res) => { const workers = await checkWorkerCount(req.params.mineId); res.json({ success: true, data: workers }); });
app.post('/api/emergency', async (req, res) => { await triggerEmergency(req.body.mine_id, req.body.type); res.json({ success: true }); });
app.post('/api/blasts', async (req, res) => { await logBlast(req.body.mine_id, req.body); res.json({ success: true }); });
app.get('/api/blasts/:mineId', async (req, res) => { const blasts = await getBlastHistory(req.params.mineId); res.json({ success: true, data: blasts }); });
app.get('/health', (req, res) => res.json({ status: 'healthy', service: 'mining-security' }));

const PORT = process.env.PORT || 3111;
app.listen(PORT, () => console.log(`Mining Security Service on port ${PORT}`));

export default app;