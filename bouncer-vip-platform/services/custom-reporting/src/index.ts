// ===========================================
// Custom Reporting Service
// Report builder, templates, scheduling
// ===========================================

import express, { Request, Response } from 'express';
import { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';

const app = express();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

app.use(express.json());

// ===========================================
// Types
// ===========================================

interface ReportDefinition {
  id: string;
  name: string;
  description: string;
  type: 'tabular' | 'chart' | 'dashboard' | 'invoice';
  source_table: string;
  columns: ReportColumn[];
  filters: ReportFilter[];
  group_by?: string[];
  order_by?: string[];
  created_by: string;
  is_template: boolean;
  created_at: string;
}

interface ReportColumn {
  name: string;
  label: string;
  type: 'string' | 'number' | 'date' | 'currency' | 'percentage';
  aggregation?: 'sum' | 'avg' | 'count' | 'min' | 'max';
}

interface ReportFilter {
  column: string;
  operator: 'eq' | 'ne' | 'gt' | 'lt' | 'gte' | 'lte' | 'in' | 'like' | 'between';
  value: any;
}

interface ReportSchedule {
  id: string;
  report_id: string;
  frequency: 'daily' | 'weekly' | 'monthly';
  recipients: string[];
  format: 'pdf' | 'csv' | 'excel';
  next_run: string;
  active: boolean;
}

// ===========================================
// Report Templates
// ===========================================

const REPORT_TEMPLATES: Partial<ReportDefinition>[] = [
  {
    name: 'Revenue Report',
    description: 'Monthly revenue breakdown',
    type: 'tabular',
    source_table: 'invoices',
    columns: [
      { name: 'invoice_number', label: 'Invoice #', type: 'string' },
      { name: 'client_name', label: 'Client', type: 'string' },
      { name: 'amount', label: 'Amount', type: 'currency' },
      { name: 'status', label: 'Status', type: 'string' },
    ],
  },
  {
    name: 'Officer Performance',
    description: 'Officer shift performance',
    type: 'chart',
    source_table: 'shifts',
    columns: [
      { name: 'officer_name', label: 'Officer', type: 'string' },
      { name: 'shifts_completed', label: 'Shifts', type: 'number', aggregation: 'count' },
      { name: 'hours_worked', label: 'Hours', type: 'number', aggregation: 'sum' },
      { name: 'rating', label: 'Rating', type: 'number', aggregation: 'avg' },
    ],
  },
  {
    name: 'Incident Summary',
    description: 'Incident overview',
    type: 'dashboard',
    source_table: 'incidents',
    columns: [
      { name: 'title', label: 'Title', type: 'string' },
      { name: 'severity', label: 'Severity', type: 'string' },
      { name: 'status', label: 'Status', type: 'string' },
    ],
  },
];

// ===========================================
// Report Builder
// ===========================================

class ReportBuilder {
  buildQuery(definition: ReportDefinition): string {
    const columns = definition.columns.map(col => {
      if (col.aggregation) {
        return `${col.aggregation}(${col.name}) as ${col.name}`;
      }
      return col.name;
    }).join(', ');

    let query = `SELECT ${columns} FROM ${definition.source_table}`;
    const params: any[] = [];

    // Add filters
    if (definition.filters && definition.filters.length > 0) {
      query += ' WHERE ';
      const whereClauses = definition.filters.map((filter, i) => {
        params.push(filter.value);
        return this.buildFilterClause(filter, i + 1);
      });
      query += whereClauses.join(' AND ');
    }

    // Add group by
    if (definition.group_by && definition.group_by.length > 0) {
      query += ` GROUP BY ${definition.group_by.join(', ')}`;
    }

    // Add order by
    if (definition.order_by && definition.order_by.length > 0) {
      query += ` ORDER BY ${definition.order_by.join(', ')}`;
    }

    return { query, params };
  }

  private buildFilterClause(filter: ReportFilter, paramIndex: number): string {
    const param = `$${paramIndex}`;

    switch (filter.operator) {
      case 'eq': return `${filter.column} = ${param}`;
      case 'ne': return `${filter.column} != ${param}`;
      case 'gt': return `${filter.column} > ${param}`;
      case 'lt': return `${filter.column} < ${param}`;
      case 'gte': return `${filter.column} >= ${param}`;
      case 'lte': return `${filter.column} <= ${param}`;
      case 'in': return `${filter.column} = ANY(${param})`;
      case 'like': return `${filter.column} LIKE ${param}`;
      case 'between': return `${filter.column} BETWEEN ${param} AND $${paramIndex + 1}`;
      default: return '1=1';
    }
  }

  async execute(definition: ReportDefinition): Promise<any[]> {
    const { query, params } = this.buildQuery(definition);
    const result = await pool.query(query, params);
    return result.rows;
  }

  async executeWithPagination(definition: ReportDefinition, page: number = 1, limit: number = 50): Promise<{ data: any[]; total: number }> {
    const { query, params } = this.buildQuery(definition);
    
    // Get total
    const countQuery = `SELECT COUNT(*) as total FROM (${query}) as subquery`;
    const countResult = await pool.query(countQuery, params);
    const total = parseInt(countResult.rows[0]?.total || '0');

    // Add pagination
    const paginatedQuery = `${query} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    const dataResult = await pool.query(paginatedQuery, [...params, limit, (page - 1) * limit]);

    return { data: dataResult.rows, total };
  }
}

const reportBuilder = new ReportBuilder();

// ===========================================
// Report Management
// ===========================================

async function createReport(data: Partial<ReportDefinition>): Promise<ReportDefinition> {
  const id = uuidv4();

  await pool.query(`
    INSERT INTO report_definitions (id, name, description, type, source_table, columns, filters, group_by, order_by, created_by, is_template)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
  `, [id, data.name, data.description, data.type, data.source_table, JSON.stringify(data.columns), 
      JSON.stringify(data.filters), JSON.stringify(data.group_by), JSON.stringify(data.order_by), 
      data.created_by, data.is_template || false]);

  return { id, ...data, created_at: new Date().toISOString() } as ReportDefinition;
}

async function getReports(filters?: { created_by?: string; is_template?: boolean }): Promise<ReportDefinition[]> {
  let query = 'SELECT * FROM report_definitions WHERE 1=1';
  const params: any[] = [];

  if (filters?.created_by) {
    params.push(filters.created_by);
    query += ` AND created_by = $${params.length}`;
  }
  if (filters?.is_template !== undefined) {
    params.push(filters.is_template);
    query += ` AND is_template = $${params.length}`;
  }

  query += ' ORDER BY created_at DESC';
  const result = await pool.query(query, params);

  return result.rows.map(r => ({
    ...r,
    columns: JSON.parse(r.columns),
    filters: JSON.parse(r.filters),
    group_by: JSON.parse(r.group_by || '[]'),
    order_by: JSON.parse(r.order_by || '[]'),
  }));
}

async function runReport(reportId: string, params?: any): Promise<any[]> {
  const reports = await getReports();
  const report = reports.find(r => r.id === reportId);

  if (!report) throw new Error('Report not found');

  // Apply runtime params to filters
  if (params) {
    report.filters = report.filters.map(f => ({
      ...f,
      value: params[f.column] || f.value,
    }));
  }

  return reportBuilder.execute(report);
}

// ===========================================
// Report Scheduling
// ===========================================

async function scheduleReport(data: Partial<ReportSchedule>): Promise<ReportSchedule> {
  const id = uuidv4();
  
  await pool.query(`
    INSERT INTO report_schedules (id, report_id, frequency, recipients, format, next_run, active)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
  `, [id, data.report_id, data.frequency, JSON.stringify(data.recipients), data.format, data.next_run, true]);

  return { id, ...data } as ReportSchedule;
}

async function runScheduledReports(): Promise<void> {
  const dueReports = await pool.query(`
    SELECT * FROM report_schedules 
    WHERE active = true AND next_run <= NOW()
  `);

  for (const schedule of dueReports.rows) {
    try {
      await runReport(schedule.report_id);
      // Update next run time
      const nextRun = new Date();
      if (schedule.frequency === 'daily') nextRun.setDate(nextRun.getDate() + 1);
      else if (schedule.frequency === 'weekly') nextRun.setDate(nextRun.getDate() + 7);
      else nextRun.setMonth(nextRun.getMonth() + 1);

      await pool.query(`
        UPDATE report_schedules SET next_run = $1 WHERE id = $2
      `, [nextRun, schedule.id]);
    } catch (error) {
      console.error(`Failed to run scheduled report ${schedule.id}:`, error);
    }
  }
}

// Run scheduled reports every hour
setInterval(runScheduledReports, 60 * 60 * 1000);

// ===========================================
// Export
// ===========================================

async function exportReport(reportId: string, format: 'pdf' | 'csv' | 'excel'): Promise<Buffer | string> {
  const data = await runReport(reportId);

  if (format === 'csv') {
    const headers = Object.keys(data[0] || {}).join(',');
    const rows = data.map(row => Object.values(row).join(',')).join('\n');
    return `${headers}\n${rows}`;
  }

  // PDF/Excel would require additional libraries
  return JSON.stringify(data);
}

// ===========================================
// API Routes
// ===========================================

app.post('/api/reports', async (req: Request, res: Response) => {
  try {
    const report = await createReport(req.body);
    res.status(201).json({ success: true, data: report });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to create report' });
  }
});

app.get('/api/reports', async (req: Request, res: Response) => {
  try {
    const reports = await getReports(req.query as any);
    res.json({ success: true, data: reports });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch reports' });
  }
});

app.get('/api/reports/templates', async (req: Request, res: Response) => {
  res.json({ success: true, data: REPORT_TEMPLATES });
});

app.get('/api/reports/:id/run', async (req: Request, res: Response) => {
  try {
    const { page, limit, ...params } = req.query;
    const result = await reportBuilder.executeWithPagination(
      (await getReports()).find(r => r.id === req.params.id)!,
      parseInt(page as any) || 1,
      parseInt(limit as any) || 50
    );
    res.json({ success: true, data: result.data, total: result.total });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to run report' });
  }
});

app.post('/api/reports/:id/export', async (req: Request, res: Response) => {
  try {
    const { format } = req.body;
    const data = await exportReport(req.params.id, format);
    res.setHeader('Content-Type', format === 'csv' ? 'text/csv' : 'application/json');
    res.send(data);
  } catch (error) {
    res.status(500).json({ success: false, error: 'Export failed' });
  }
});

app.post('/api/schedules', async (req: Request, res: Response) => {
  try {
    const schedule = await scheduleReport(req.body);
    res.status(201).json({ success: true, data: schedule });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to schedule report' });
  }
});

app.get('/health', async (req: Request, res: Response) => {
  res.json({ status: 'healthy', service: 'custom-reporting' });
});

const PORT = process.env.PORT || 3082;

app.listen(PORT, () => console.log(`Custom Reporting Service on port ${PORT}`));

export default app;