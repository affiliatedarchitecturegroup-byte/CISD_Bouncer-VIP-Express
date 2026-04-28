// Dashboard Customization - Themes/Layouts
import express from 'express';
import { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';

const app = express();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
app.use(express.json());

// Themes
const defaultThemes = [
  { id: 'light', name: 'Light', primary: '#007AFF', background: '#ffffff' },
  { id: 'dark', name: 'Dark', primary: '#0A84FF', background: '#000000' },
  { id: 'corporate', name: 'Corporate', primary: '#2563EB', background: '#F8FAFC' },
];

async function createTheme(data: any): Promise<any> {
  const id = uuidv4();
  await pool.query(`INSERT INTO dashboard_themes (id, name, config) VALUES ($1, $2, $3)`, [id, data.name, JSON.stringify(data.config)]);
  return { id, ...data };
}

async function createLayout(data: any): Promise<any> {
  const id = uuidv4();
  await pool.query(`INSERT INTO dashboard_layouts (id, name, config) VALUES ($1, $2, $3)`, [id, data.name, JSON.stringify(data.config)]);
  return { id, ...data };
}

app.get('/api/themes', (req, res) => res.json({ success: true, data: defaultThemes }));
app.post('/api/themes', async (req, res) => { const t = await createTheme(req.body); res.json({ success: true, data: t }); });
app.post('/api/layouts', async (req, res) => { const l = await createLayout(req.body); res.json({ success: true, data: l }); });
app.get('/health', (req, res) => res.json({ status: 'healthy', service: 'dashboard-customization' }));

const PORT = process.env.PORT || 3304;
app.listen(PORT, () => console.log(`Dashboard Customization on port ${PORT}`));

export default app;