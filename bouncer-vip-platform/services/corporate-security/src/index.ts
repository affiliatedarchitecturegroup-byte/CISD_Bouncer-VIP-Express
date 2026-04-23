// ===========================================
// Corporate Security Service
// Office buildings, business parks
// ===========================================

import express, { Request, Response } from 'express';
import { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';

const app = express();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
app.use(express.json());

// Types
interface Tenant { id: string; building_id: string; name: string; floor: string; employees: number; }
interface Visitor { id: string; building_id: string; host: string; company: string; check_in: string; check_out?: string; }

// Building Management
async function registerBuilding(data: { name: string; address: string; floors: number; tenants: number }): Promise<any> {
  const id = uuidv4();
  await pool.query(`INSERT INTO corporate_buildings (id, name, address, floors, tenants, status) VALUES ($1, $2, $3, $4, 'active')`, [id, data.name, data.address, data.floors]);
  return { id, ...data, tenants: 0 };
}

// Tenant Management
async function addTenant(data: { building_id: string; name: string; floor: string; employees: number }): Promise<Tenant> {
  const id = uuidv4();
  await pool.query(`INSERT INTO corporate_tenants (id, building_id, name, floor, employees) VALUES ($1, $2, $3, $4, $5)`, [id, data.building_id, data.name, data.floor, data.employees]);
  return { id, ...data };
}

async function getTenants(buildingId: string): Promise<Tenant[]> {
  const result = await pool.query('SELECT * FROM corporate_tenants WHERE building_id = $1', [buildingId]);
  return result.rows;
}

// Visitor Management
async function registerVisitor(data: { building_id: string; host: string; company: string }): Promise<Visitor> {
  const id = uuidv4();
  await pool.query(`INSERT INTO corporate_visitors (id, building_id, host, company, check_in) VALUES ($1, $2, $3, $4, NOW())`, [id, data.building_id, data.host, data.company]);
  return { id, ...data, check_in: new Date().toISOString() };
}

async function checkOutVisitor(visitorId: string): Promise<void> {
  await pool.query('UPDATE corporate_visitors SET check_out = NOW() WHERE id = $1', [visitorId]);
}

async function getVisitors(buildingId: string): Promise<Visitor[]> {
  const result = await pool.query('SELECT * FROM corporate_visitors WHERE building_id = $1 ORDER BY check_in DESC', [buildingId]);
  return result.rows;
}

// Access Control
async function grantAccess(tenantId: string, floors: string[]): Promise<void> {
  await pool.query('INSERT INTO access_rules (id, tenant_id, floors, granted_at) VALUES ($1, $2, $3, NOW())', [uuidv4(), tenantId, JSON.stringify(floors)]);
}

async function getAccessLog(buildingId: string): Promise<any[]> {
  const result = await pool.query('SELECT * FROM access_logs WHERE building_id = $1 ORDER BY timestamp DESC LIMIT 100', [buildingId]);
  return result.rows;
}

// API Routes
app.post('/api/buildings', async (req, res) => { const building = await registerBuilding(req.body); res.json({ success: true, data: building }); });
app.post('/api/tenants', async (req, res) => { const tenant = await addTenant(req.body); res.json({ success: true, data: tenant }); });
app.get('/api/tenants/:buildingId', async (req, res) => { const tenants = await getTenants(req.params.buildingId); res.json({ success: true, data: tenants }); });
app.post('/api/visitors', async (req, res) => { const visitor = await registerVisitor(req.body); res.json({ success: true, data: visitor }); });
app.post('/api/visitors/:id/checkout', async (req, res) => { await checkOutVisitor(req.params.id); res.json({ success: true }); });
app.get('/api/visitors/:buildingId', async (req, res) => { const visitors = await getVisitors(req.params.buildingId); res.json({ success: true, data: visitors }); });
app.post('/api/access', async (req, res) => { await grantAccess(req.body.tenant_id, req.body.floors); res.json({ success: true }); });
app.get('/api/access/:buildingId', async (req, res) => { const logs = await getAccessLog(req.params.buildingId); res.json({ success: true, data: logs }); });
app.get('/health', (req, res) => res.json({ status: 'healthy', service: 'corporate-security' }));

const PORT = process.env.PORT || 3143;
app.listen(PORT, () => console.log(`Corporate Security Service on port ${PORT}`));

export default app;