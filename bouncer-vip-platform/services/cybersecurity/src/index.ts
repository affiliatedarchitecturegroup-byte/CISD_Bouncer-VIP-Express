// Cybersecurity Service
import express from 'express';
import { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';
const app = express();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
app.use(express.json());

async function scanNetwork(data: { network: string; scope: string }) {
  const id = uuidv4();
  await pool.query('INSERT INTO security_scans (id, network, scope, status, started_at) VALUES ($1, $2, $3, $4, NOW())', [id, data.network, data.scope, 'running']);
  return { id, ...data, status: 'running' };
}

async function logThreat(data: { type: string; severity: string; source: string }) {
  const id = uuidv4();
  await pool.query('INSERT INTO cyber_threats (id, type, severity, source, detected_at) VALUES ($1, $2, $3, $4, NOW())', [id, data.type, data.severity, data.source]);
  return { id, ...data };
}

async function complianceCheck(data: { standard: string; organization: string }) {
  const id = uuidv4();
  await pool.query('INSERT INTO compliance_checks (id, standard, organization, status, checked_at) VALUES ($1, $2, $3, $4, NOW())', [id, data.standard, data.organization, 'pending']);
  return { id, ...data, status: 'pending' };
}

app.post('/api/scans', async (req, res) => { const s = await scanNetwork(req.body); res.json({ success: true, data: s }); });
app.post('/api/threats', async (req, res) => { const t = await logThreat(req.body); res.json({ success: true, data: t }); });
app.post('/api/compliance', async (req, res) => { const c = await complianceCheck(req.body); res.json({ success: true, data: c }); });
app.get('/health', (req, res) => res.json({ status: 'healthy', service: 'cybersecurity' }));

const PORT = process.env.PORT || 3153;
app.listen(PORT, () => console.log(`Cybersecurity Service on port ${PORT}`));
export default app;