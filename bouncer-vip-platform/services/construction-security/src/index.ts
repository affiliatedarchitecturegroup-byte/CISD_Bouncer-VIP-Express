// ===========================================
// Construction Security Service
// Site security, equipment protection, worker safety
// ===========================================

import express, { Request, Response } from 'express';
import { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';

const app = express();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
app.use(express.json());

// Types
interface Site { id: string; name: string; address: string; value: number; workers: number; status: string; }
interface Worker { id: string; site_id: string; name: string; trade: string; safety_cert: boolean; }
interface Equipment { id: string; site_id: string; name: string; serial: string; value: number; }

// Site Management
async function registerSite(data: { name: string; address: string; value: number }): Promise<Site> {
  const id = uuidv4();
  await pool.query(`INSERT INTO construction_sites (id, name, address, value, status) VALUES ($1, $2, $3, $4, 'active')`, [id, data.name, data.address, data.value]);
  return { id, ...data, workers: 0, status: 'active' };
}

async function getSites(): Promise<Site[]> {
  const result = await pool.query('SELECT * FROM construction_sites');
  return result.rows;
}

// Worker Safety
async function registerWorker(data: { site_id: string; name: string; trade: string }): Promise<Worker> {
  const id = uuidv4();
  await pool.query(`INSERT INTO construction_workers (id, site_id, name, trade, safety_cert) VALUES ($1, $2, $3, $4, false)`, [id, data.site_id, data.name, data.trade]);
  return { id, ...data, safety_cert: false };
}

async function getWorkers(siteId: string): Promise<Worker[]> {
  const result = await pool.query('SELECT * FROM construction_workers WHERE site_id = $1', [siteId]);
  return result.rows;
}

async function updateSafetyCert(workerId: string, certified: boolean): Promise<void> {
  await pool.query('UPDATE construction_workers SET safety_cert = $1 WHERE id = $2', [certified, workerId]);
}

// Equipment Tracking
async function registerEquipment(data: { site_id: string; name: string; serial: string; value: number }): Promise<Equipment> {
  const id = uuidv4();
  await pool.query(`INSERT INTO construction_equipment (id, site_id, name, serial, value) VALUES ($1, $2, $3, $4, $5)`, [id, data.site_id, data.name, data.serial, data.value]);
  return { id, ...data };
}

async function getEquipment(siteId: string): Promise<Equipment[]> {
  const result = await pool.query('SELECT * FROM construction_equipment WHERE site_id = $1', [siteId]);
  return result.rows;
}

// Safety Incidents
async function reportIncident(data: { site_id: string; type: string; worker_id?: string; description: string }): Promise<any> {
  const id = uuidv4();
  await pool.query(`INSERT INTO safety_incidents (id, site_id, type, worker_id, description, status) VALUES ($1, $2, $3, $4, $5, 'open')`, [id, data.site_id, data.type, data.worker_id, data.description]);
  return { id, ...data, status: 'open' };
}

async function getIncidents(siteId: string): Promise<any[]> {
  const result = await pool.query('SELECT * FROM safety_incidents WHERE site_id = $1 ORDER BY created_at DESC', [siteId]);
  return result.rows;
}

// Daily Reports
async function createDailyReport(data: { site_id: string; workers_present: number; work_completed: string; issues: string }): Promise<any> {
  const id = uuidv4();
  await pool.query(`INSERT INTO daily_reports (id, site_id, workers_present, work_completed, issues, date) VALUES ($1, $2, $3, $4, $5, NOW())`, [id, data.site_id, data.workers_present, data.work_completed, data.issues]);
  return { id, ...data };
}

async function getReports(siteId: string): Promise<any[]> {
  const result = await pool.query('SELECT * FROM daily_reports WHERE site_id = $1 ORDER BY date DESC', [siteId]);
  return result.rows;
}

// API Routes
app.post('/api/sites', async (req, res) => { const site = await registerSite(req.body); res.json({ success: true, data: site }); });
app.get('/api/sites', async (req, res) => { const sites = await getSites(); res.json({ success: true, data: sites }); });
app.post('/api/workers', async (req, res) => { const worker = await registerWorker(req.body); res.json({ success: true, data: worker }); });
app.get('/api/workers/:siteId', async (req, res) => { const workers = await getWorkers(req.params.siteId); res.json({ success: true, data: workers }); });
app.post('/api/workers/:id/cert', async (req, res) => { await updateSafetyCert(req.params.id, req.body.certified); res.json({ success: true }); });
app.post('/api/equipment', async (req, res) => { const equipment = await registerEquipment(req.body); res.json({ success: true, data: equipment }); });
app.get('/api/equipment/:siteId', async (req, res) => { const equipment = await getEquipment(req.params.siteId); res.json({ success: true, data: equipment }); });
app.post('/api/incidents', async (req, res) => { const incident = await reportIncident(req.body); res.json({ success: true, data: incident }); });
app.get('/api/incidents/:siteId', async (req, res) => { const incidents = await getIncidents(req.params.siteId); res.json({ success: true, data: incidents }); });
app.post('/api/reports', async (req, res) => { const report = await createDailyReport(req.body); res.json({ success: true, data: report }); });
app.get('/api/reports/:siteId', async (req, res) => { const reports = await getReports(req.params.siteId); res.json({ success: true, data: reports }); });
app.get('/health', (req, res) => res.json({ status: 'healthy', service: 'construction-security' }));

const PORT = process.env.PORT || 3141;
app.listen(PORT, () => console.log(`Construction Security Service on port ${PORT}`));

export default app;