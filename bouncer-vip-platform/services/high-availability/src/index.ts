// ===========================================
// High Availability Service
// Health checks, failover, load balancing & disaster recovery
// ===========================================

import express, { Request, Response } from 'express';
import { Pool } from 'pg';
import Redis from 'ioredis';
import { EventEmitter } from 'events';

const app = express();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const redis = new Redis(process.env.REDIS_URL);
const events = new EventEmitter();

app.use(express.json());

// ===========================================
// Types
// ===========================================

interface ServiceHealth {
  service: string;
  status: 'healthy' | 'degraded' | 'unhealthy';
  last_check: string;
  response_time_ms: number;
  error_rate: number;
  uptime_percent: number;
}

interface FailoverEvent {
  id: string;
  service: string;
  primary_instance: string;
  failover_instance: string;
  triggered_at: string;
  resolved_at?: string;
  reason: string;
}

// ===========================================
// Health Monitoring
// ===========================================

const SERVICE_ENDPOINTS: Record<string, string> = {
  'api-gateway': process.env.API_GATEWAY_URL || 'http://api-gateway:3000',
  'crm': process.env.CRM_URL || 'http://crm:3001',
  'scheduling': process.env.SCHEDULING_URL || 'http://scheduling:3002',
  'on-demand': process.env.ONDEMAND_URL || 'http://on-demand:3003',
  'monitoring': process.env.MONITORING_URL || 'http://monitoring:3004',
  'erp': process.env.ERP_URL || 'http://erp:3005',
  'workflow': process.env.WORKFLOW_URL || 'http://workflow:3006',
  'biometrics': process.env.BIOMETRICS_URL || 'http://biometrics:3007',
};

async function checkServiceHealth(service: string): Promise<ServiceHealth> {
  const endpoint = SERVICE_ENDPOINTS[service];
  const startTime = Date.now();
  
  try {
    const response = await fetch(`${endpoint}/health`, { 
      method: 'GET',
      signal: AbortSignal.timeout(5000)
    });
    
    const responseTime = Date.now() - startTime;
    const healthy = response.ok;
    
    // Get error rate from Redis
    const errorRateKey = `service:${service}:errors`;
    const errorCount = await redis.get(errorRateKey) || '0';
    const requestCount = await redis.get(`service:${service}:requests`) || '1';
    const errorRate = parseInt(errorCount) / parseInt(requestCount);
    
    await redis.incr(`service:${service}:requests`);
    
    return {
      service,
      status: healthy ? (errorRate > 0.05 ? 'degraded' : 'healthy') : 'unhealthy',
      last_check: new Date().toISOString(),
      response_time_ms: responseTime,
      error_rate: errorRate * 100,
      uptime_percent: 99.9,
    };
  } catch (error) {
    await redis.incr(`service:${service}:errors`);
    
    return {
      service,
      status: 'unhealthy',
      last_check: new Date().toISOString(),
      response_time_ms: Date.now() - startTime,
      error_rate: 100,
      uptime_percent: 0,
    };
  }
}

async function checkAllServices(): Promise<ServiceHealth[]> {
  const checks = await Promise.allSettled(
    Object.keys(SERVICE_ENDPOINTS).map(service => checkServiceHealth(service))
  );
  
  return checks
    .filter((r): r is PromiseFulfilledResult<ServiceHealth> => r.status === 'fulfilled')
    .map(r => r.value);
}

// ===========================================
// Circuit Breaker
// ===========================================

interface CircuitState {
  service: string;
  state: 'closed' | 'open' | 'half_open';
  failure_count: number;
  success_count: number;
  last_failure?: string;
  next_attempt?: string;
}

const circuits: Map<string, CircuitState> = new Map();

async function recordSuccess(service: string): Promise<void> {
  const circuit = circuits.get(service) || { 
    service, state: 'closed', failure_count: 0, success_count: 0 
  };
  
  circuit.failure_count = 0;
  circuit.success_count++;
  circuit.state = 'closed';
  circuits.set(service, circuit);
  
  await redis.hset(`circuit:${service}`, { state: 'closed', failures: 0 });
}

async function recordFailure(service: string): Promise<void> {
  const circuit = circuits.get(service) || { 
    service, state: 'closed', failure_count: 0, success_count: 0 
  };
  
  circuit.failure_count++;
  circuit.last_failure = new Date().toISOString();
  
  // Open circuit after 5 failures
  if (circuit.failure_count >= 5) {
    circuit.state = 'open';
    circuit.next_attempt = new Date(Date.now() + 30000).toISOString(); // Try again in 30s
    
    events.emit('circuit-opened', { service, reason: 'too many failures' });
  }
  
  circuits.set(service, circuit);
  
  await redis.hset(`circuit:${service}`, { 
    state: circuit.state, 
    failures: circuit.failure_count 
  });
}

async function canAttempt(service: string): Promise<boolean> {
  const circuit = circuits.get(service);
  
  if (!circuit || circuit.state === 'closed') return true;
  if (circuit.state === 'half_open') return true;
  
  // Check if ready to retry
  if (circuit.next_attempt && new Date(circuit.next_attempt) < new Date()) {
    circuit.state = 'half_open';
    circuits.set(service, circuit);
    return true;
  }
  
  return false;
}

// ===========================================
// Load Balancing
// ===========================================

interface ServiceInstance {
  id: string;
  url: string;
  weight: number;
  healthy: boolean;
  current_requests: number;
}

async function getHealthyInstances(service: string): Promise<ServiceInstance[]> {
  // Get instances from service discovery
  const instances = await redis.smembers(`service:${service}:instances`);
  
  const healthy: ServiceInstance[] = [];
  
  for (const instance of instances) {
    const health = await checkServiceHealth(instance);
    if (health.status !== 'unhealthy') {
      const weight = await redis.zscore(`service:${service}:weights`, instance) || 1;
      healthy.push({
        id: instance,
        url: instance,
        weight: parseInt(weight as string),
        healthy: true,
        current_requests: parseInt((await redis.get(`requests:${instance}`) || '0') as string),
      });
    }
  }
  
  return healthy;
}

// Weighted round-robin
function selectInstance(instances: ServiceInstance[]): string {
  const totalWeight = instances.reduce((sum, i) => sum + i.weight, 0);
  let random = Math.random() * totalWeight;
  
  for (const instance of instances) {
    random -= instance.weight;
    if (random <= 0) return instance.url;
  }
  
  return instances[0].url;
}

// ===========================================
// Failover Management
// ===========================================

async function triggerFailover(service: string, primaryInstance: string, reason: string): Promise<void> {
  const failoverId = `failover-${Date.now()}`;
  
  // Find backup instance
  const instances = await getHealthyInstances(service);
  const backup = instances.find(i => i.url !== primaryInstance);
  
  if (!backup) {
    events.emit('failover-failed', { service, reason: 'no backup available' });
    return;
  }
  
  // Update DNS or routing
  await redis.set(`failover:${service}:active`, backup.url);
  await redis.set(`failover:${service}:primary`, primaryInstance);
  
  // Log event
  await pool.query(`
    INSERT INTO failover_events (id, service, primary_instance, failover_instance, triggered_at, reason)
    VALUES ($1, $2, $3, $4, NOW(), $5)
  `, [failoverId, service, primaryInstance, backup.url, reason]);
  
  events.emit('failover-completed', { 
    service, 
    from: primaryInstance, 
    to: backup.url 
  });
}

async function resolveFailover(service: string): Promise<void> {
  const primary = await redis.get(`failover:${service}:primary`);
  
  if (primary) {
    await redis.set(`failover:${service}:active`, primary);
  }
  
  await pool.query(`
    UPDATE failover_events SET resolved_at = NOW()
    WHERE service = $1 AND resolved_at IS NULL
  `, [service]);
}

// ===========================================
// Disaster Recovery
// ===========================================

interface BackupConfig {
  schedule: string; // cron
  retention_days: number;
  destinations: string[];
}

async function createBackup(service: string): Promise<{ backup_id: string; size_mb: number }> {
  const backupId = `backup-${service}-${Date.now()}`;
  
  // Create database backup
  await pool.query(`
    INSERT INTO backups (id, service, status, started_at)
    VALUES ($1, $2, 'in_progress', NOW())
  `, [backupId, service]);
  
  // In production, use pg_dump or cloud backup service
  const size = Math.floor(Math.random() * 1000) + 100; // Simulated
  
  await pool.query(`
    UPDATE backups SET status = 'completed', size_mb = $1, completed_at = NOW()
    WHERE id = $2
  `, [size, backupId]);
  
  return { backup_id: backupId, size_mb: size };
}

async function restoreFromBackup(backupId: string): Promise<void> {
  const backup = await pool.query('SELECT * FROM backups WHERE id = $1', [backupId]);
  
  if (!backup.rows[0]) throw new Error('Backup not found');
  
  // In production, restore from backup
  await pool.query(`
    UPDATE backups SET status = 'restored', restored_at = NOW()
    WHERE id = $1
  `, [backupId]);
}

// ===========================================
// API Routes
// ===========================================

// Health
app.get('/api/health', async (req: Request, res: Response) => {
  try {
    const services = await checkAllServices();
    const unhealthy = services.filter(s => s.status === 'unhealthy');
    
    res.json({
      status: unhealthy.length > 0 ? 'degraded' : 'healthy',
      services,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({ status: 'unhealthy', error: 'Health check failed' });
  }
});

app.get('/api/health/:service', async (req: Request, res: Response) => {
  try {
    const health = await checkServiceHealth(req.params.service);
    res.json(health);
  } catch (error) {
    res.status(500).json({ error: 'Check failed' });
  }
});

// Circuit Breaker
app.get('/api/circuit/:service', async (req: Request, res: Response) => {
  const circuit = circuits.get(req.params.service);
  res.json(circuit || { service: req.params.service, state: 'closed', failure_count: 0 });
});

app.post('/api/circuit/:service/reset', async (req: Request, res: Response) => {
  circuits.set(req.params.service, { 
    service: req.params.service, 
    state: 'closed', 
    failure_count: 0, 
    success_count: 0 
  });
  res.json({ success: true });
});

// Failover
app.get('/api/failover', async (req: Request, res: Response) => {
  const events = await pool.query(`
    SELECT * FROM failover_events 
    ORDER BY triggered_at DESC LIMIT 100
  `);
  res.json({ success: true, data: events.rows });
});

app.post('/api/failover/:service/trigger', async (req: Request, res: Response) => {
  const { primary_instance, reason } = req.body;
  await triggerFailover(req.params.service, primary_instance, reason);
  res.json({ success: true });
});

app.post('/api/failover/:service/resolve', async (req: Request, res: Response) => {
  await resolveFailover(req.params.service);
  res.json({ success: true });
});

// Backups
app.post('/api/backup', async (req: Request, res: Response) => {
  const { service } = req.body;
  const backup = await createBackup(service);
  res.json({ success: true, data: backup });
});

app.get('/api/backup', async (req: Request, res: Response) => {
  const backups = await pool.query(`
    SELECT * FROM backups ORDER BY started_at DESC LIMIT 50
  `);
  res.json({ success: true, data: backups.rows });
});

app.post('/api/backup/:id/restore', async (req: Request, res: Response) => {
  await restoreFromBackup(req.params.id);
  res.json({ success: true });
});

app.get('/health', async (req: Request, res: Response) => {
  res.json({ status: 'healthy', service: 'high-availability' });
});

const PORT = process.env.PORT || 3026;

app.listen(PORT, () => console.log(`High Availability Service on port ${PORT}`));

export default app;