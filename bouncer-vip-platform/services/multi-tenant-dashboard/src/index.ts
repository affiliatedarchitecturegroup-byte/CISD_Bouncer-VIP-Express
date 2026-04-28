// Multi-tenant Dashboard Service
import express from 'express';
import { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';

const app = express();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
app.use(express.json());

// Tenant isolation
async function getTenantData(tenantId: string, table: string): Promise<any[]> {
  const result = await pool.query(`SELECT * FROM ${table} WHERE tenant_id = $1`, [tenantId]);
  return result.rows;
}

async function getTenantSettings(tenantId: string): Promise<any> {
  const result = await pool.query(`SELECT * FROM tenant_settings WHERE tenant_id = $1`, [tenantId]);
  return result.rows[0] || {};
}

async function updateTenantSettings(tenantId: string, settings: any): Promise<void> {
  await pool.query(`INSERT INTO tenant_settings (tenant_id, settings) VALUES ($1, $2) ON CONFLICT(tenant_id) DO UPDATE SET settings = $2`,
    [tenantId, JSON.stringify(settings)]);
}

async function getSubscription(tenantId: string): Promise<any> {
  const result = await pool.query(`SELECT * FROM subscriptions WHERE tenant_id = $1 AND status = 'active'`, [tenantId]);
  return result.rows[0] || null;
}

app.get('/api/tenants/:id/data', async (req, res) => {
  const { table } = req.query;
  const data = await getTenantData(req.params.id, table as string);
  res.json({ success: true, data });
});
app.get('/api/tenants/:id/settings', async (req, res) => {
  const settings = await getTenantSettings(req.params.id);
  res.json({ success: true, data: settings });
});
app.put('/api/tenants/:id/settings', async (req, res) => {
  await updateTenantSettings(req.params.id, req.body);
  res.json({ success: true });
});
app.get('/api/tenants/:id/subscription', async (req, res) => {
  const sub = await getSubscription(req.params.id);
  res.json({ success: true, data: sub });
});
app.get('/health', (req, res) => res.json({ status: 'healthy', service: 'multi-tenant-dashboard' }));

const PORT = process.env.PORT || 3305;
app.listen(PORT, () => console.log(`Multi-tenant Dashboard on port ${PORT}`));

export default app;