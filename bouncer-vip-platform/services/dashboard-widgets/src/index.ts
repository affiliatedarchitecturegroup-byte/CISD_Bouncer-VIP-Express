// ===========================================
// Dashboard Widgets Service
// Phase 3.2 - Widget library
// ===========================================

import express, { Request, Response } from 'express';
import { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';

const app = express();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
app.use(express.json());

// Predefined widgets
const widgetLibrary = [
  { id: 'stats_bookings', name: 'Bookings Stats', type: 'stat', config: { size: 'small' } },
  { id: 'chart_revenue', name: 'Revenue Chart', type: 'chart', config: { chart_type: 'line' } },
  { id: 'map_locations', name: 'Activity Map', type: 'map', config: { size: 'large' } },
  { id: 'table_incidents', name: 'Recent Incidents', type: 'table', config: { size: 'medium' } },
];

async function registerWidget(data: any): Promise<any> {
  const id = uuidv4();
  await pool.query(`INSERT INTO dashboard_widgets (id, name, type, config) VALUES ($1, $2, $3, $4)`,
    [id, data.name, data.type, JSON.stringify(data.config || {})]);
  return { id, ...data };
}

async function getWidget(id: string): Promise<any> {
  const result = await pool.query('SELECT * FROM dashboard_widgets WHERE id = $1', [id]);
  return result.rows[0] || null;
}

async function createTemplate(data: any): Promise<any> {
  const id = uuidv4();
  await pool.query(`INSERT INTO dashboard_templates (id, name, widgets) VALUES ($1, $2, $3)`,
    [id, data.name, JSON.stringify(data.widgets)]);
  return { id, ...data };
}

async function getTemplates(): Promise<any[]> {
  const result = await pool.query('SELECT * FROM dashboard_templates');
  return result.rows;
}

// API Routes
app.get('/api/widgets/library', (req, res) => res.json({ success: true, data: widgetLibrary }));
app.post('/api/widgets', async (req, res) => { const w = await registerWidget(req.body); res.json({ success: true, data: w }); });
app.get('/api/widgets/:id', async (req, res) => { const w = await getWidget(req.params.id); res.json({ success: true, data: w }); });
app.post('/api/templates', async (req, res) => { const t = await createTemplate(req.body); res.json({ success: true, data: t }); });
app.get('/api/templates', async (req, res) => { const t = await getTemplates(); res.json({ success: true, data: t }); });
app.get('/health', (req, res) => res.json({ status: 'healthy', service: 'dashboard-widgets' }));

const PORT = process.env.PORT || 3301;
app.listen(PORT, () => console.log(`Dashboard Widgets on port ${PORT}`));

export default app;