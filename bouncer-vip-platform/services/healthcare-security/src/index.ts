// ===========================================
// Healthcare Security Service
// Hospital, clinic, pharmaceutical security
// ===========================================

import express, { Request, Response } from 'express';
import { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';

const app = express();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
app.use(express.json());

async function registerFacility(data: { name: string; type: string; beds: number; areas: string[] }): Promise<any> {
  const id = uuidv4();
  await pool.query(`INSERT INTO healthcare_facilities (id, name, type, beds, status) VALUES ($1, $2, $3, $4, 'active')`, [id, data.name, data.type, data.beds]);
  return { id, ...data };
}

async function controlAccess(area: string, patientId: string, allowed: boolean): Promise<void> {
  await pool.query('INSERT INTO area_access (id, area, patient_id, allowed, timestamp) VALUES ($1, $2, $3, $4, NOW())', [uuidv4(), area, patientId, allowed]);
}

async function trackAssets(facilityId: string): Promise<any[]> {
  const result = await pool.query('SELECT * FROM medical_assets WHERE facility_id = $1', [facilityId]);
  return result.rows;
}

async function reportIncident(data: { facility_id: string; type: string; severity: string; description: string }): Promise<any> {
  const id = uuidv4();
  await pool.query('INSERT INTO health_incidents (id, facility_id, type, severity, description, status) VALUES ($1, $2, $3, $4, $5, $6)', [id, data.facility_id, data.type, data.severity, data.description, 'open']);
  return { id, ...data };
}

app.post('/api/facilities', async (req, res) => { const f = await registerFacility(req.body); res.json({ success: true, data: f }); });
app.post('/api/access', async (req, res) => { await controlAccess(req.body.area, req.body.patient_id, req.body.allowed); res.json({ success: true }); });
app.get('/api/assets/:facilityId', async (req, res) => { const a = await trackAssets(req.params.facilityId); res.json({ success: true, data: a }); });
app.post('/api/incidents', async (req, res) => { const i = await reportIncident(req.body); res.json({ success: true, data: i }); });
app.get('/health', (req, res) => res.json({ status: 'healthy', service: 'healthcare-security' }));

const PORT = process.env.PORT || 3144;
app.listen(PORT, () => console.log(`Healthcare Security Service on port ${PORT}`));

export default app;