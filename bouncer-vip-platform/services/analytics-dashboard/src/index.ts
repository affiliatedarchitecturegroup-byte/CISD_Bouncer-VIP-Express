// ===========================================
// Analytics Dashboard Service
// Advanced reporting and business intelligence
// ===========================================

import express, { Request, Response } from 'express';
import { Pool } from 'pg';
import Redis from 'ioredis';
import { format, subDays, subMonths, startOfMonth, endOfMonth } from 'date-fns';

const app = express();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const redis = new Redis(process.env.REDIS_URL);

app.use(express.json());

// ===========================================
// Dashboard Overview
// ===========================================

interface DashboardData {
  revenue: { current: number; previous: number; change: number };
  bookings: { current: number; previous: number; change: number };
  officers: { active: number; available: number };
  incidents: { open: number; resolved: number };
  attendance: { rate: number; trend: number };
}

async function getDashboardOverview(dateRange: 'today' | 'week' | 'month' | 'year'): Promise<DashboardData> {
  const now = new Date();
  let currentStart: Date;
  let previousStart: Date;
  
  switch (dateRange) {
    case 'today':
      currentStart = startOfMonth(now);
      previousStart = startOfMonth(subMonths(now, 1));
      break;
    case 'week':
      currentStart = subDays(now, 7);
      previousStart = subDays(now, 14);
      break;
    case 'month':
      currentStart = startOfMonth(now);
      previousStart = startOfMonth(subMonths(now, 1));
      break;
    case 'year':
      currentStart = new Date(now.getFullYear(), 0, 1);
      previousStart = new Date(now.getFullYear() - 1, 0, 1);
      break;
  }
  
  // Revenue
  const [revenueCurrent, revenuePrevious] = await Promise.all([
    pool.query(`
      SELECT COALESCE(SUM(total_amount), 0) as total 
      FROM invoices WHERE status = 'paid' AND paid_at >= $1
    `, [currentStart]),
    pool.query(`
      SELECT COALESCE(SUM(total_amount), 0) as total 
      FROM invoices WHERE status = 'paid' AND paid_at >= $1 AND paid_at < $2
    `, [previousStart, currentStart]),
  ]);
  
  // Bookings
  const [bookingsCurrent, bookingsPrevious] = await Promise.all([
    pool.query(`SELECT COUNT(*) as count FROM bookings WHERE created_at >= $1`, [currentStart]),
    pool.query(`SELECT COUNT(*) as count FROM bookings WHERE created_at >= $1 AND created_at < $2`, [previousStart, currentStart]),
  ]);
  
  // Officers
  const [activeOfficers, availableOfficers] = await Promise.all([
    pool.query(`SELECT COUNT(*) as count FROM officers WHERE status = 'active'`),
    pool.query(`
      SELECT COUNT(*) as count FROM officers o
      WHERE o.status = 'active'
        AND o.id NOT IN (SELECT DISTINCT officer_id FROM shifts WHERE status = 'clocked_in')
    `),
  ]);
  
  // Incidents
  const [openIncidents, resolvedIncidents] = await Promise.all([
    pool.query(`SELECT COUNT(*) as count FROM incidents WHERE status IN ('open', 'investigating')`),
    pool.query(`SELECT COUNT(*) as count FROM incidents WHERE status = 'resolved' AND resolved_at >= $1`, [currentStart]),
  ]);
  
  // Attendance
  const attendanceResult = await pool.query(`
    SELECT 
      COUNT(*) FILTER (WHERE status = 'completed') as completed,
      COUNT(*) as total
    FROM shifts WHERE check_in_time >= $1
  `, [currentStart]);
  
  const completed = parseInt(attendanceResult.rows[0]?.completed || '0');
  const total = parseInt(attendanceResult.rows[0]?.total || '1');
  const attendanceRate = Math.round((completed / total) * 100);
  
  return {
    revenue: {
      current: parseFloat(revenueCurrent.rows[0]?.total || '0'),
      previous: parseFloat(revenuePrevious.rows[0]?.total || '0'),
      change: calculateChange(
        parseFloat(revenueCurrent.rows[0]?.total || '0'),
        parseFloat(revenuePrevious.rows[0]?.total || '0')
      ),
    },
    bookings: {
      current: parseInt(bookingsCurrent.rows[0]?.count || '0'),
      previous: parseInt(bookingsPrevious.rows[0]?.count || '0'),
      change: calculateChange(
        parseInt(bookingsCurrent.rows[0]?.count || '0'),
        parseInt(bookingsPrevious.rows[0]?.count || '0')
      ),
    },
    officers: {
      active: parseInt(activeOfficers.rows[0]?.count || '0'),
      available: parseInt(availableOfficers.rows[0]?.count || '0'),
    },
    incidents: {
      open: parseInt(openIncidents.rows[0]?.count || '0'),
      resolved: parseInt(resolvedIncidents.rows[0]?.count || '0'),
    },
    attendance: {
      rate: attendanceRate,
      trend: 0,
    },
  };
}

function calculateChange(current: number, previous: number): number {
  if (previous === 0) return current > 0 ? 100 : 0;
  return Math.round(((current - previous) / previous) * 100);
}

// ===========================================
// Revenue Analytics
// ===========================================

interface RevenueData {
  labels: string[];
  data: number[];
}

async function getRevenueByDay(days: number = 30): Promise<RevenueData> {
  const result = await pool.query(`
    SELECT DATE(paid_at) as date, SUM(total_amount) as revenue
    FROM invoices
    WHERE status = 'paid' AND paid_at >= $1
    GROUP BY DATE(paid_at)
    ORDER BY date
  `, [subDays(new Date(), days)]);
  
  return {
    labels: result.rows.map(r => r.date),
    data: result.rows.map(r => parseFloat(r.revenue)),
  };
}

async function getRevenueByVenue(): Promise<{ venue: string; revenue: number }[]> {
  const result = await pool.query(`
    SELECT v.name as venue, SUM(i.total_amount) as revenue
    FROM invoices i
    JOIN venues v ON i.venue_id = v.id
    WHERE i.status = 'paid'
    GROUP BY v.id, v.name
    ORDER BY revenue DESC
    LIMIT 10
  `);
  
  return result.rows.map(r => ({
    venue: r.venue,
    revenue: parseFloat(r.revenue),
  }));
}

async function getRevenueByServiceType(): Promise<{ type: string; revenue: number }[]> {
  const result = await pool.query(`
    SELECT s.service_type as type, SUM(s.actual_hours * s.hourly_rate) as revenue
    FROM shifts s
    GROUP BY s.service_type
  `);
  
  return result.rows.map(r => ({
    type: r.type,
    revenue: parseFloat(r.revenue),
  }));
}

// ===========================================
// Occupancy Analytics
// ===========================================

async function getOccupancyByHour(): Promise<{ hour: number; count: number }[]> {
  const result = await pool.query(`
    SELECT EXTRACT(HOUR FROM check_in_time) as hour, COUNT(*) as count
    FROM shifts
    WHERE check_in_time >= NOW() - INTERVAL '30 days'
    GROUP BY EXTRACT(HOUR FROM check_in_time)
    ORDER BY hour
  `);
  
  return result.rows.map(r => ({
    hour: parseInt(r.hour),
    count: parseInt(r.count),
  }));
}

async function getOccupancyByDayOfWeek(): Promise<{ day: number; count: number }[]> {
  const result = await pool.query(`
    SELECT EXTRACT(DOW FROM check_in_time) as day, COUNT(*) as count
    FROM shifts
    WHERE check_in_time >= NOW() - INTERVAL '30 days'
    GROUP BY EXTRACT(DOW FROM check_in_time)
    ORDER BY day
  `);
  
  return result.rows.map(r => ({
    day: parseInt(r.day),
    count: parseInt(r.count),
  }));
}

// ===========================================
// Officer Analytics
// ===========================================

interface OfficerPerformance {
  id: string;
  name: string;
  shiftsCompleted: number;
  hoursWorked: number;
  earnings: number;
  rating: number;
  incidentsHandled: number;
}

async function getTopPerformers(limit: number = 10): Promise<OfficerPerformance[]> {
  const result = await pool.query(`
    SELECT 
      o.id,
      o.first_name || ' ' || o.last_name as name,
      COUNT(s.id) as shifts_completed,
      COALESCE(SUM(s.actual_hours), 0) as hours_worked,
      COALESCE(SUM(s.actual_hours * s.hourly_rate), 0) as earnings,
      COALESCE(AVG(o.rating), 0) as rating,
      (SELECT COUNT(*) FROM incidents i WHERE i.officer_id = o.id) as incidents_handled
    FROM officers o
    LEFT JOIN shifts s ON o.id = s.officer_id AND s.status = 'completed'
    WHERE o.status = 'active'
    GROUP BY o.id
    ORDER BY earnings DESC
    LIMIT $1
  `, [limit]);
  
  return result.rows.map(r => ({
    id: r.id,
    name: r.name,
    shiftsCompleted: parseInt(r.shifts_completed),
    hoursWorked: parseFloat(r.hours_worked),
    earnings: parseFloat(r.earnings),
    rating: Math.round(parseFloat(r.rating) * 10) / 10,
    incidentsHandled: parseInt(r.incidents_handled),
  }));
}

async function getOfficerUtilization(): Promise<{ id: string; name: string; utilization: number }[]> {
  const result = await pool.query(`
    SELECT 
      o.id,
      o.first_name || ' ' || o.last_name as name,
      COUNT(s.id)::float / 30 * 100 as utilization
    FROM officers o
    LEFT JOIN shifts s ON o.id = s.officer_id AND s.check_in_time >= NOW() - INTERVAL '30 days'
    WHERE o.status = 'active'
    GROUP BY o.id
    ORDER BY utilization DESC
  `);
  
  return result.rows.map(r => ({
    id: r.id,
    name: r.name,
    utilization: Math.round(parseFloat(r.utilization)),
  }));
}

// ===========================================
// Incident Analytics
// ===========================================

async function getIncidentsByType(): Promise<{ type: string; count: number }[]> {
  const result = await pool.query(`
    SELECT incident_type, COUNT(*) as count
    FROM incidents
    WHERE created_at >= NOW() - INTERVAL '90 days'
    GROUP BY incident_type
    ORDER BY count DESC
  `);
  
  return result.rows.map(r => ({
    type: r.incident_type,
    count: parseInt(r.count),
  }));
}

async function getIncidentsByVenue(): Promise<{ venue: string; count: number }[]> {
  const result = await pool.query(`
    SELECT v.name as venue, COUNT(i.id) as count
    FROM incidents i
    JOIN venues v ON i.venue_id = v.id
    WHERE i.created_at >= NOW() - INTERVAL '90 days'
    GROUP BY v.id, v.name
    ORDER BY count DESC
    LIMIT 10
  `);
  
  return result.rows.map(r => ({
    venue: r.venue,
    count: parseInt(r.count),
  }));
}

// ===========================================
// Executive Summary
// ===========================================

async function getExecutiveSummary(): Promise<{
  kpis: { label: string; value: string; change: string; trend: 'up' | 'down' | 'flat' }[];
  alerts: { severity: string; message: string }[];
}> {
  const dashboard = await getDashboardOverview('month');
  
  const kpis = [
    { label: 'Monthly Revenue', value: `R${dashboard.revenue.current.toLocaleString()}`, change: `${dashboard.revenue.change}%`, trend: dashboard.revenue.change > 0 ? 'up' as const : 'down' as const },
    { label: 'Active Bookings', value: dashboard.bookings.current.toString(), change: `${dashboard.bookings.change}%`, trend: dashboard.bookings.change > 0 ? 'up' as const : 'down' as const },
    { label: 'Officer Attendance', value: `${dashboard.attendance.rate}%`, change: '0%', trend: 'flat' as const },
    { label: 'Open Incidents', value: dashboard.incidents.open.toString(), change: '0', trend: 'flat' as const },
  ];
  
  const alerts: any[] = [];
  
  // Low attendance alert
  if (dashboard.attendance.rate < 90) {
    alerts.push({ severity: 'warning', message: 'Attendance rate below 90%' });
  }
  
  // High incidents alert
  if (dashboard.incidents.open > 5) {
    alerts.push({ severity: 'critical', message: `${dashboard.incidents.open} open incidents` });
  }
  
  return { kpis, alerts };
}

// ===========================================
// Export
// ===========================================

async function exportReport(format: 'csv' | 'pdf', type: string, dateRange: { start: string; end: string }): Promise<Buffer | string> {
  // Simplified export
  if (format === 'csv') {
    const data = await getRevenueByDay(30);
    let csv = 'Date,Revenue\n';
    data.labels.forEach((label, i) => {
      csv += `${label},${data.data[i]}\n`;
    });
    return csv;
  }
  
  return 'PDF export not implemented';
}

// ===========================================
// API Routes
// ===========================================

app.get('/api/overview', async (req: Request, res: Response) => {
  try {
    const { range } = req.query as any;
    const data = await getDashboardOverview(range || 'month');
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch overview' });
  }
});

app.get('/api/revenue/by-day', async (req: Request, res: Response) => {
  try {
    const { days } = req.query;
    const data = await getRevenueByDay(parseInt(days as any) || 30);
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch revenue' });
  }
});

app.get('/api/revenue/by-venue', async (req: Request, res: Response) => {
  try {
    const data = await getRevenueByVenue();
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch revenue' });
  }
});

app.get('/api/officers/top', async (req: Request, res: Response) => {
  try {
    const { limit } = req.query;
    const data = await getTopPerformers(parseInt(limit as any) || 10);
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch officers' });
  }
});

app.get('/api/incidents/by-type', async (req: Request, res: Response) => {
  try {
    const data = await getIncidentsByType();
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch incidents' });
  }
});

app.get('/api/executive-summary', async (req: Request, res: Response) => {
  try {
    const data = await getExecutiveSummary();
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch summary' });
  }
});

app.post('/api/export', async (req: Request, res: Response) => {
  try {
    const { format, type, start, end } = req.body;
    const data = await exportReport(format, type, { start, end });
    
    res.setHeader('Content-Type', format === 'csv' ? 'text/csv' : 'application/pdf');
    res.send(data);
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to export' });
  }
});

app.get('/health', async (req: Request, res: Response) => {
  res.json({ status: 'healthy', service: 'analytics-dashboard' });
});

const PORT = process.env.PORT || 3032;

app.listen(PORT, () => console.log(`Analytics Dashboard Service on port ${PORT}`));

export default app;