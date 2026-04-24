import express from 'express';
import { Pool } from 'pg';
const app = express();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
app.use(express.json());

async function getProfitLoss(s, e) { return { revenue: 0, expenses: 0 }; }
async function getBalanceSheet() { return { assets: 0, liabilities: 0 }; }
async function getTaxReport(y) { return { vat: 0, tax: 0 }; }

app.get('/api/reports/pnl', async (req, res) => res.json({ success: true, data: await getProfitLoss(req.query.s, req.query.e) }));
app.get('/api/reports/balance', async (res) => res.json({ success: true, data: await getBalanceSheet() }));
app.get('/api/reports/tax/:year', async (req, res) => res.json({ success: true, data: await getTaxReport(req.params.year) }));
app.get('/health', (req, res) => res.json({ status: 'healthy' }));
const PORT = 3402;
app.listen(PORT, () => console.log(`Financial Reporting on ${PORT}`));
export default app;
