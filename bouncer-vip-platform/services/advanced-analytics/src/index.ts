// ===========================================
// Advanced Analytics Service
// ML dashboards, predictions, trends
// ===========================================

import express, { Request, Response } from 'express';
import { Pool } from 'pg';
import Redis from 'ioredis';

const app = express();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const redis = new Redis(process.env.REDIS_URL);

app.use(express.json());

// ===========================================
// Dashboard Widgets
// ===========================================

async function getRevenueWidget(): Promise<any> {
  const [daily, weekly, monthly, ytd] = await Promise.all([
    pool.query(`
      SELECT DATE(paid_at) as date, SUM(total_amount) as revenue
      FROM invoices WHERE status = 'paid' AND paid_at >= NOW() - INTERVAL '1 day'
      GROUP BY DATE(paid_at)
    `),
    pool.query(`
      SELECT DATE(paid_at) as date, SUM(total_amount) as revenue
      FROM invoices WHERE status = 'paid' AND paid_at >= NOW() - INTERVAL '7 days'
      GROUP BY DATE(paid_at)
    `),
    pool.query(`
      SELECT DATE(paid_at) as date, SUM(total_amount) as revenue
      FROM invoices WHERE status = 'paid' AND paid_at >= NOW() - INTERVAL '30 days'
      GROUP BY DATE(paid_at)
    `),
    pool.query(`
      SELECT SUM(total_amount) as revenue FROM invoices WHERE status = 'paid'
      AND EXTRACT(YEAR FROM paid_at) = EXTRACT(YEAR FROM NOW())
    `),
  ]);

  return {
    daily: daily.rows,
    weekly: weekly.rows,
    monthly: monthly.rows,
    ytd: parseFloat(ytd.rows[0]?.revenue || '0'),
  };
}

async function getBookingsWidget(): Promise<any> {
  const [total, byStatus, byType, trend] = await Promise.all([
    pool.query('SELECT COUNT(*) as count FROM bookings'),
    pool.query(`
      SELECT status, COUNT(*) as count FROM bookings GROUP BY status
    `),
    pool.query(`
      SELECT service_type, COUNT(*) as count FROM bookings GROUP BY service_type
    `),
    pool.query(`
      SELECT DATE(created_at) as date, COUNT(*) as count
      FROM bookings WHERE created_at >= NOW() - INTERVAL '30 days'
      GROUP BY DATE(created_at)
    `),
  ]);

  return {
    total: parseInt(total.rows[0]?.count || '0'),
    byStatus: byStatus.rows,
    byType: byType.rows,
    trend: trend.rows,
  };
}

async function getOfficersWidget(): Promise<any> {
  const [total, active, byGrade, topPerformers, utilization] = await Promise.all([
    pool.query('SELECT COUNT(*) as count FROM officers'),
    pool.query("SELECT COUNT(*) as count FROM officers WHERE status = 'active'"),
    pool.query(`
      SELECT grade, COUNT(*) as count FROM officers GROUP BY grade
    `),
    pool.query(`
      SELECT o.id, o.first_name, o.last_name, COUNT(s.id) as shifts, AVG(o.rating) as rating
      FROM officers o
      LEFT JOIN shifts s ON o.id = s.officer_id AND s.status = 'completed'
      WHERE o.status = 'active'
      GROUP BY o.id
      ORDER BY shifts DESC
      LIMIT 10
    `),
    pool.query(`
      SELECT DATE(check_in_time) as date, 
             COUNT(DISTINCT officer_id) as active_officers,
             COUNT(*) as total_shifts
      FROM shifts WHERE check_in_time >= NOW() - INTERVAL '30 days'
      GROUP BY DATE(check_in_time)
    `),
  ]);

  return {
    total: parseInt(total.rows[0]?.count || '0'),
    active: parseInt(active.rows[0]?.count || '0'),
    byGrade: byGrade.rows,
    topPerformers: topPerformers.rows,
    utilization: utilization.rows,
  };
}

async function getIncidentsWidget(): Promise<any> {
  const [total, bySeverity, byType, trend] = await Promise.all([
    pool.query('SELECT COUNT(*) as count FROM incidents'),
    pool.query(`
      SELECT severity, COUNT(*) as count FROM incidents GROUP BY severity
    `),
    pool.query(`
      SELECT incident_type, COUNT(*) as count FROM incidents GROUP BY incident_type
    `),
    pool.query(`
      SELECT DATE(created_at) as date, severity, COUNT(*) as count
      FROM incidents WHERE created_at >= NOW() - INTERVAL '30 days'
      GROUP BY DATE(created_at), severity
    `),
  ]);

  return {
    total: parseInt(total.rows[0]?.count || '0'),
    bySeverity: bySeverity.rows,
    byType: byType.rows,
    trend: trend.rows,
  };
}

// ===========================================
// Predictive Analytics
// ===========================================

async function predictDemand(daysAhead: number = 7): Promise<any[]> {
  // Simple prediction based on historical patterns
  const predictions: any[] = [];

  for (let i = 1; i <= daysAhead; i++) {
    const date = new Date();
    date.setDate(date.getDate() + i);
    const dayOfWeek = date.getDay();

    // Historical average for this day of week
    const result = await pool.query(`
      SELECT AVG(demand) as avg_demand FROM demand_forecasts
      WHERE day_of_week = $1
    `, [dayOfWeek]);

    predictions.push({
      date: date.toISOString().split('T')[0],
      predicted_demand: parseFloat(result.rows[0]?.avg_demand || '10'),
      confidence: 0.75,
    });
  }

  return predictions;
}

async function predictRevenue(monthsAhead: number = 3): Promise<any[]> {
  const predictions: any[] = [];
  const currentMonth = new Date();

  for (let i = 0; i < monthsAhead; i++) {
    const month = new Date(currentMonth);
    month.setMonth(month.getMonth() + i);

    // Get historical average for this month
    const result = await pool.query(`
      SELECT AVG(monthly_revenue) as avg_revenue FROM monthly_reports
      WHERE EXTRACT(MONTH FROM month) = $1
    `, [month.getMonth() + 1]);

    predictions.push({
      month: month.toISOString().slice(0, 7),
      predicted_revenue: parseFloat(result.rows[0]?.avg_revenue || '100000'),
      confidence: 0.7,
    });
  }

  return predictions;
}

async function getChurnRisk(): Promise<any[]> {
  // Identify clients at risk of churning
  const result = await pool.query(`
    SELECT c.id, c.name, c.email,
           COUNT(b.id) as recent_bookings,
           MAX(b.created_at) as last_booking,
           DATEDIFF(NOW(), MAX(b.created_at)) as days_since_booking
    FROM clients c
    LEFT JOIN bookings b ON c.id = b.client_id
    GROUP BY c.id
    HAVING DATEDIFF(NOW(), MAX(b.created_at)) > 60
    ORDER BY days_since_booking DESC
    LIMIT 20
  `);

  return result.rows.map(r => ({
    ...r,
    risk_score: Math.min(100, r.days_since_booking * 2),
  }));
}

// ===========================================
// Cohort Analysis
// ===========================================

async function getCohortAnalysis(): Promise<any> {
  const result = await pool.query(`
    SELECT 
      DATE_TRUNC('month', created_at) as cohort_month,
      COUNT(*) as cohort_size,
      COUNT(DISTINCT CASE WHEN status = 'active' THEN id END) as active_users,
      ROUND(COUNT(DISTINCT CASE WHEN status = 'active' THEN id END)::numeric / COUNT(*) * 100, 2) as retention_rate
    FROM clients
    WHERE created_at >= NOW() - INTERVAL '12 months'
    GROUP BY DATE_TRUNC('month', created_at)
    ORDER BY cohort_month
  `);

  return result.rows;
}

async function getRevenueByCohort(): Promise<any> {
  const result = await pool.query(`
    SELECT 
      DATE_TRUNC('month', c.created_at) as cohort_month,
      SUM(i.total_amount) as total_revenue,
      COUNT(DISTINCT c.id) as clients,
      ROUND(SUM(i.total_amount) / COUNT(DISTINCT c.id), 2) as revenue_per_client
    FROM clients c
    JOIN invoices i ON c.id = i.client_id AND i.status = 'paid'
    WHERE c.created_at >= NOW() - INTERVAL '12 months'
    GROUP BY DATE_TRUNC('month', c.created_at)
    ORDER BY cohort_month
  `);

  return result.rows;
}

// ===========================================
// Funnel Analysis
// ===========================================

async function getBookingFunnel(): Promise<any> {
  const result = await pool.query(`
    SELECT 
      'inquiries' as stage,
      COUNT(*) as count
    FROM quote_requests
    UNION ALL
    SELECT 
      'quotes_sent' as stage,
      COUNT(*) as count
    FROM quotes
    UNION ALL
    SELECT 
      'bookings' as stage,
      COUNT(*) as count
    FROM bookings
    UNION ALL
    SELECT 
      'completed' as stage,
      COUNT(*) as count
    FROM bookings WHERE status = 'completed'
  `);

  return result.rows;
}

// ===========================================
// API Routes
// ===========================================

app.get('/api/dashboard/revenue', async (req: Request, res: Response) => {
  try {
    const data = await getRevenueWidget();
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch' });
  }
});

app.get('/api/dashboard/bookings', async (req: Request, res: Response) => {
  try {
    const data = await getBookingsWidget();
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch' });
  }
});

app.get('/api/dashboard/officers', async (req: Request, res: Response) => {
  try {
    const data = await getOfficersWidget();
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch' });
  }
});

app.get('/api/dashboard/incidents', async (req: Request, res: Response) => {
  try {
    const data = await getIncidentsWidget();
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch' });
  }
});

app.get('/api/predictions/demand', async (req: Request, res: Response) => {
  try {
    const { days } = req.query;
    const data = await predictDemand(parseInt(days as any) || 7);
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Prediction failed' });
  }
});

app.get('/api/predictions/revenue', async (req: Request, res: Response) => {
  try {
    const { months } = req.query;
    const data = await predictRevenue(parseInt(months as any) || 3);
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Prediction failed' });
  }
});

app.get('/api/churn-risk', async (req: Request, res: Response) => {
  try {
    const data = await getChurnRisk();
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch' });
  }
});

app.get('/api/cohorts', async (req: Request, res: Response) => {
  try {
    const data = await getCohortAnalysis();
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch' });
  }
});

app.get('/api/funnel', async (req: Request, res: Response) => {
  try {
    const data = await getBookingFunnel();
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch' });
  }
});

app.get('/health', async (req: Request, res: Response) => {
  res.json({ status: 'healthy', service: 'advanced-analytics' });
});

const PORT = process.env.PORT || 3081;

app.listen(PORT, () => console.log(`Advanced Analytics Service on port ${PORT}`));

export default app;