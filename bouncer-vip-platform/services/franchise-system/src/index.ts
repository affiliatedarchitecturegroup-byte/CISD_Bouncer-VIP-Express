// ===========================================
// Franchise System Service
// Partner management, white-label, franchise operations
// ===========================================

import express, { Request, Response } from 'express';
import { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';

const app = express();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
app.use(express.json());

// Types
interface Franchise { id: string; name: string; partner_id: string; status: string; region: string; revenue_share: number; }
interface WhiteLabelConfig { id: string; franchise_id: string; domain: string; theme: any; features: string[]; }

// Franchise Management
async function createFranchise(data: { name: string; partner_id: string; region: string; revenue_share: number }): Promise<Franchise> {
  const id = uuidv4();
  await pool.query(`INSERT INTO franchises (id, name, partner_id, region, revenue_share, status) VALUES ($1, $2, $3, $4, $5, 'active')`, [id, data.name, data.partner_id, data.region, data.revenue_share]);
  return { id, ...data, status: 'active' };
}

async function getFranchises(): Promise<Franchise[]> {
  const result = await pool.query('SELECT * FROM franchises');
  return result.rows;
}

async function getFranchiseById(id: string): Promise<Franchise | null> {
  const result = await pool.query('SELECT * FROM franchises WHERE id = $1', [id]);
  return result.rows[0];
}

// Revenue Sharing
async function calculateRevenueShare(franchiseId: string, grossRevenue: number): Promise<{ gross: number; franchise_share: number; platform_fee: number; net: number }> {
  const franchise = await getFranchiseById(franchiseId);
  const franchiseShare = grossRevenue * ((franchise?.revenue_share || 70) / 100);
  const platformFee = grossRevenue * 0.1;
  return { gross: grossRevenue, franchise_share: franchiseShare, platform_fee: platformFee, net: grossRevenue - platformFee };
}

// White-Label
async function createWhiteLabelConfig(franchiseId: string, config: { domain: string; primary_color: string; logo: string }): Promise<WhiteLabelConfig> {
  const id = uuidv4();
  const theme = { primary_color: config.primary_color, logo: config.logo };
  await pool.query(`INSERT INTO white_label_configs (id, franchise_id, domain, theme, status) VALUES ($1, $2, $3, $4, 'active')`, [id, franchiseId, config.domain, JSON.stringify(theme)]);
  return { id, franchise_id: franchiseId, domain: config.domain, theme, features: [] };
}

async function getWhiteLabelConfig(franchiseId: string): Promise<WhiteLabelConfig | null> {
  const result = await pool.query('SELECT * FROM white_label_configs WHERE franchise_id = $1', [franchiseId]);
  return result.rows[0];
}

// Partner Portal
async function getPartnerDashboard(partnerId: string): Promise<any> {
  const [franchises, revenue, bookings] = await Promise.all([
    pool.query('SELECT * FROM franchises WHERE partner_id = $1', [partnerId]),
    pool.query('SELECT SUM(revenue) as total FROM franchise_revenue WHERE partner_id = $1', [partnerId]),
    pool.query('SELECT COUNT(*) as count FROM bookings WHERE franchise_id IN (SELECT id FROM franchises WHERE partner_id = $1)', [partnerId]),
  ]);
  return { franchises: franchises.rows, total_revenue: revenue.rows[0]?.total || 0, total_bookings: bookings.rows[0]?.count || 0 };
}

// API Routes
app.post('/api/franchises', async (req, res) => { const franchise = await createFranchise(req.body); res.json({ success: true, data: franchise }); });
app.get('/api/franchises', async (req, res) => { const franchises = await getFranchises(); res.json({ success: true, data: franchises }); });
app.get('/api/franchises/:id', async (req, res) => { const franchise = await getFranchiseById(req.params.id); res.json({ success: true, data: franchise }); });
app.post('/api/franchises/:id/revenue', async (req, res) => { const { gross_revenue } = req.body; const calculation = await calculateRevenueShare(req.params.id, gross_revenue); res.json({ success: true, data: calculation }); });
app.post('/api/whitelabel', async (req, res) => { const config = await createWhiteLabelConfig(req.body.franchise_id, req.body); res.json({ success: true, data: config }); });
app.get('/api/whitelabel/:franchiseId', async (req, res) => { const config = await getWhiteLabelConfig(req.params.franchiseId); res.json({ success: true, data: config }); });
app.get('/api/partner/:id/dashboard', async (req, res) => { const dashboard = await getPartnerDashboard(req.params.id); res.json({ success: true, data: dashboard }); });
app.get('/health', (req, res) => res.json({ status: 'healthy', service: 'franchise-system' }));

const PORT = process.env.PORT || 3130;
app.listen(PORT, () => console.log(`Franchise System Service on port ${PORT}`));

export default app;