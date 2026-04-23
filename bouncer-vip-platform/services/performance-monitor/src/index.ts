// ===========================================
// Performance Monitor Service
// Phase 1.7 - Metrics and monitoring
// ===========================================

import express, { Request, Response } from 'express';
import { Pool } from 'pg';
import os from 'os';

const app = express();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
app.use(express.json());

// ===========================================
// System Metrics
// ===========================================

export interface SystemMetrics {
  cpu: {
    usage: number;
    cores: number;
  loadavg: number[];
  };
  memory: {
    total: number;
    used: number;
    free: number;
    usagePercent: number;
  };
  uptime: number;
  timestamp: string;
}

export interface ServiceMetrics {
  service: string;
  requests: number;
  errors: number;
  avgResponseTime: number;
  p95ResponseTime: number;
  status: string;
}

// Get system metrics
export function getSystemMetrics(): SystemMetrics {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;
  
  return {
    cpu: {
      usage: os.loadavg()[0] * 100 / os.cpus().length,
      cores: os.cpus().length,
      loadavg: os.loadavg(),
    },
    memory: {
      total: totalMem,
      used: usedMem,
      free: freeMem,
      usagePercent: (usedMem / totalMem) * 100,
    },
    uptime: os.uptime(),
    timestamp: new Date().toISOString(),
  };
}

// Database metrics
export async function getDatabaseMetrics(): Promise<any> {
  const poolObj = pool as any;
  return {
    totalConnections: poolObj.totalCount,
    idleConnections: poolObj.idleCount,
    waitingConnections: poolObj.waitingCount,
    maxConnections: poolObj.options.max,
  };
}

// Application metrics (from custom metrics table)
export async function getServiceMetrics(serviceName: string): Promise<ServiceMetrics | null> {
  try {
    const result = await pool.query(`
      SELECT 
        service,
        SUM(requests) as requests,
        SUM(errors) as errors,
        AVG(avg_response_time) as avg_response_time,
        AVG(p95_response_time) as p95_response_time,
        MAX(status) as status
      FROM service_metrics
      WHERE service = $1 AND period_start > NOW() - INTERVAL '5 minutes'
      GROUP BY service
    `, [serviceName]);

    return result.rows[0] || null;
  } catch {
    return null;
  }
}

// API response time metrics
const responseTimes: number[] = [];

export function recordResponseTime(endpoint: string, timeMs: number): void {
  responseTimes.push(timeMs);
  if (responseTimes.length > 1000) responseTimes.shift();
}

export function getEndpointMetrics(endpoint: string): { avg: number; p95: number; p99: number } {
  const sorted = [...responseTimes].sort((a, b) => a - b);
  const p95 = sorted[Math.floor(sorted.length * 0.95)] || 0;
  const p99 = sorted[Math.floor(sorted.length * 0.99)] || 0;
  
  return {
    avg: responseTimes.reduce((a, b) => a + b, 0) / (responseTimes.length || 1),
    p95,
    p99,
  };
}

// Health check with detailed status
export async function getDetailedHealth(): Promise<any> {
  const system = getSystemMetrics();
  const db = await getDatabaseMetrics();
  
  const issues: string[] = [];
  
  if (system.cpu.usage > 90) issues.push('High CPU usage');
  if (system.memory.usagePercent > 90) issues.push('High memory usage');
  if (db.waitingConnections > 5) issues.push('Database waiting connections');
  
  return {
    healthy: issues.length === 0,
    system,
    database: db,
    issues,
  };
}

// ===========================================
// Middleware - Response Time Tracking
// ===========================================

export function metricsMiddleware(req: Request, res: Response, next: NextFunction) {
  const startTime = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    recordResponseTime(req.path, duration);
  });
  
  next();
}

// ===========================================
// API Routes
// ===========================================

app.get('/api/metrics/system', (req: Request, res: Response) => {
  const metrics = getSystemMetrics();
  res.json({ success: true, data: metrics });
});

app.get('/api/metrics/database', async (req: Request, res: Response) => {
  const metrics = await getDatabaseMetrics();
  res.json({ success: true, data: metrics });
});

app.get('/api/metrics/service/:name', async (req: Request, res: Response) => {
  const metrics = await getServiceMetrics(req.params.name);
  res.json({ success: true, data: metrics });
});

app.get('/api/metrics/endpoint/:path', (req: Request, res: Response) => {
  const metrics = getEndpointMetrics(req.params.path);
  res.json({ success: true, data: metrics });
});

app.get('/api/health', async (req: Request, res: Response) => {
  const health = await getDetailedHealth();
  res.json(health);
});

app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'healthy', service: 'performance-monitor' });
});

const PORT = process.env.PORT || 3091;
app.listen(PORT, () => console.log(`Performance Monitor Service on port ${PORT}`));

export default app;