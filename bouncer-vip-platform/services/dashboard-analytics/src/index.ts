// ===========================================
// Dashboard Analytics Service
// Phase 3.3 - Charts, reports
// ===========================================

import express, { Request, Response } from 'express';
import { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';

const app = express();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
app.use(express.json());

// Chart types
const chartTypes = ['line', 'bar', 'pie', 'doughnut', 'area', 'scatter', 'radar', 'funnel'];

// ===========================================
// Chart Configuration
// ===========================================

interface ChartConfig {
  type: string;
  title?: string;
  data_source: string;
  dimensions: string[];
  metrics: { field: string; aggregation: 'sum' | 'avg' | 'count' | 'min' | 'max' }[];
  filters?: { field: string; operator: string; value: any }[];
  group_by?: string;
}

async function saveChart(data: ChartConfig): Promise<any> {
  const id = uuidv4();
  await pool.query(`INSERT INTO dashboard_charts (id, config, created_at) VALUES ($1, $2, NOW())`,
    [id, JSON.stringify(data)]);
  return { id, ...data };
}

async function getChart(id: string): Promise<any> {
  const result = await pool.query('SELECT * FROM dashboard_charts WHERE id = $1', [id]);
  return result.rows[0] ? { ...result.rows[0], config: JSON.parse(result.rows[0].config) } : null;
}

async function getChartData(chartId: string): Promise<any[]> {
  const chart = await getChart(chartId);
  if (!chart) return [];
  
  const { data_source, metrics, group_by, filters } = chart.config;
  const selectFields = metrics.map(m => `${m.aggregation}(${m.field}) as ${m.field}`).join(', ');
  const groupBy = group_by ? `GROUP BY ${group_by}` : '';
  
  const sql = `SELECT ${group_by || '*'}, ${selectFields} FROM ${data_source} ${groupBy}`;
  const result = await pool.query(sql);
  return result.rows;
}

// ===========================================
// Drill-down Analysis
// ===========================================

interface DrillDown {
  base_chart: string;
  levels: { field: string; label: string }[];
}

const drillDowns = new Map<string, DrillDown>();

function configureDrillDown(id: string, config: DrillDown): void {
  drillDowns.set(id, config);
}

function getDrillDownData(id: string, filters: Record<string, any>): Promise<any[]> {
  const config = drillDowns.get(id);
  if (!config) return [];
  
  let whereClause = '';
  const filterParts = Object.entries(filters).map(([k, v]) => `${k} = '${v}'`).join(' AND ');
  if (filterParts) whereClause = `WHERE ${filterParts}`;
  
  return []; // Simplified
}

// ===========================================
// Scheduled Reports
// ===========================================

interface ScheduledReport {
  id: string;
  name: string;
  chart_ids: string[];
  schedule: { frequency: 'daily' | 'weekly' | 'monthly'; time: string; day?: number };
  recipients: string[];
  format: 'pdf' | 'csv' | 'xlsx';
  active: boolean;
}

async function scheduleReport(data: Omit<ScheduledReport, 'id'>): Promise<ScheduledReport> {
  const id = uuidv4();
  await pool.query(`INSERT INTO scheduled_reports (id, name, schedule, recipients, format, active) VALUES ($1, $2, $3, $4, $5, true)`,
    [id, data.name, JSON.stringify(data.schedule), JSON.stringify(data.recipients), data.format]);
  return { id, ...data };
}

async function getScheduledReports(): Promise<ScheduledReport[]> {
  const result = await pool.query('SELECT * FROM scheduled_reports WHERE active = true');
  return result.rows.map(r => ({ ...r, schedule: JSON.parse(r.schedule), recipients: JSON.parse(r.recipients) }));
}

async function executeReport(reportId: string): Promise<Buffer> {
  const report = await getScheduledReports().then(() => null); // Simplified
  return Buffer.from('');
}

// ===========================================
// Export Capabilities
// ===========================================

async function exportToCSV(data: any[], fields: string[]): Promise<string> {
  const header = fields.join(',');
  const rows = data.map(row => fields.map(f => row[f] ?? '').join(','));
  return [header, ...rows].join('\n');
}

async function exportToPDF(chartId: string): Promise<Buffer> {
  return Buffer.from('PDF content');
}

// ===========================================
// API Routes
// ===========================================

app.get('/api/chart/types', (req: Request, res: Response) => {
  res.json({ success: true, data: chartTypes });
});

app.post('/api/charts', async (req: Request, res: Response) => {
  const chart = await saveChart(req.body);
  res.json({ success: true, data: chart });
});

app.get('/api/charts/:id', async (req: Request, res: Response) => {
  const chart = await getChart(req.params.id);
  res.json({ success: true, data: chart });
});

app.get('/api/charts/:id/data', async (req: Request, res: Response) => {
  const data = await getChartData(req.params.id);
  res.json({ success: true, data });
});

app.post('/api/drilldown', (req: Request, res: Response) => {
  configureDrillDown(req.body.id, req.body);
  res.json({ success: true });
});

app.get('/api/drilldown/:id', (req: Request, res: Response) => {
  const config = drillDowns.get(req.params.id);
  res.json({ success: true, data: config });
});

app.post('/api/reports', async (req: Request, res: Response) => {
  const report = await scheduleReport(req.body);
  res.json({ success: true, data: report });
});

app.get('/api/reports', async (req: Request, res: Response) => {
  const reports = await getScheduledReports();
  res.json({ success: true, data: reports });
});

app.post('/api/export/csv', async (req: Request, res: Response) => {
  const { data, fields } = req.body;
  const csv = await exportToCSV(data, fields);
  res.setHeader('Content-Type', 'text/csv');
  res.send(csv);
});

app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'healthy', service: 'dashboard-analytics' });
});

const PORT = process.env.PORT || 3302;
app.listen(PORT, () => console.log(`Dashboard Analytics on port ${PORT}`));

export default app;