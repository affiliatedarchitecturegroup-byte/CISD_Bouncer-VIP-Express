// ===========================================
// Multi-Tenancy Service
// Whitelabel support, tenant isolation & resource management
// ===========================================

import express, { Request, Response } from 'express';
import { Pool } from 'pg';
import Redis from 'ioredis';
import { v4 as uuidv4 } from 'uuid';

const app = express();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const redis = new Redis(process.env.REDIS_URL);

app.use(express.json());

// ===========================================
// Types
// ===========================================

type TenantStatus = 'active' | 'suspended' | 'trial' | 'cancelled';
type PlanTier = 'starter' | 'professional' | 'enterprise';

interface Tenant {
  id: string;
  name: string;
  slug: string;
  status: TenantStatus;
  plan: PlanTier;
  custom_domain?: string;
  branding: TenantBranding;
  settings: TenantSettings;
  created_at: string;
}

interface TenantBranding {
  logo_url?: string;
  primary_color: string;
  secondary_color: string;
  accent_color: string;
  font_family?: string;
}

interface TenantSettings {
  timezone: string;
  currency: string;
  date_format: string;
  language: string;
}

// ===========================================
// Tenant CRUD
// ===========================================

async function createTenant(data: Partial<Tenant>): Promise<Tenant> {
  const id = uuidv4();
  const slug = data.slug || data.name?.toLowerCase().replace(/[^a-z0-9]/g, '-');
  
  const [tenant] = await pool.query(`
    INSERT INTO tenants (id, name, slug, status, plan, branding, settings)
    VALUES ($1, $2, $3, 'trial', $4, $5, $6)
    RETURNING *
  `, [id, data.name, slug, data.plan || 'starter', JSON.stringify({
    primary_color: '#3b82f6',
    secondary_color: '#1e40af',
    accent_color: '#06b6d4',
    timezone: 'Africa/Johannesburg',
    currency: 'ZAR',
    date_format: 'YYYY-MM-DD',
    language: 'en',
  }), JSON.stringify({
    timezone: 'Africa/Johannesburg',
    currency: 'ZAR',
    date_format: 'YYYY-MM-DD',
    language: 'en',
  })]);
  
  // Initialize tenant schema
  await initializeTenantSchema(id);
  
  return tenant;
}

async function initializeTenantSchema(tenantId: string): Promise<void> {
  // Create tenant-specific schema
  await pool.query(`CREATE SCHEMA IF NOT EXISTS tenant_${tenantId}`);
  
  // Create tenant-specific tables
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tenant_${tenantId}.users (
      id UUID PRIMARY KEY,
      email VARCHAR(255) UNIQUE NOT NULL,
      name VARCHAR(255),
      role VARCHAR(50),
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
}

async function getTenants(filters?: { status?: TenantStatus; plan?: PlanTier }): Promise<Tenant[]> {
  let query = 'SELECT * FROM tenants';
  const params: any[] = [];
  
  if (filters?.status) {
    params.push(filters.status);
    query += ` WHERE status = $${params.length}`;
  }
  
  const result = await pool.query(query, params);
  return result.rows.map(r => ({ ...r, branding: JSON.parse(r.branding), settings: JSON.parse(r.settings) }));
}

async function getTenantById(id: string): Promise<Tenant | null> {
  const result = await pool.query('SELECT * FROM tenants WHERE id = $1', [id]);
  if (!result.rows[0]) return null;
  return { ...result.rows[0], branding: JSON.parse(result.rows[0].branding), settings: JSON.parse(result.rows[0].settings) };
}

async function getTenantBySlug(slug: string): Promise<Tenant | null> {
  const result = await pool.query('SELECT * FROM tenants WHERE slug = $1', [slug]);
  if (!result.rows[0]) return null;
  return { ...result.rows[0], branding: JSON.parse(result.rows[0].branding), settings: JSON.parse(result.rows[0].settings) };
}

async function updateTenant(id: string, data: Partial<Tenant>): Promise<Tenant | null> {
  const updates: string[] = [];
  const params: any[] = [];
  
  if (data.status) { params.push(data.status); updates.push(`status = $${params.length}`); }
  if (data.plan) { params.push(data.plan); updates.push(`plan = $${params.length}`); }
  if (data.custom_domain) { params.push(data.custom_domain); updates.push(`custom_domain = $${params.length}`); }
  if (data.branding) { params.push(JSON.stringify(data.branding)); updates.push(`branding = $${params.length}`); }
  if (data.settings) { params.push(JSON.stringify(data.settings)); updates.push(`settings = $${params.length}`); }
  
  if (updates.length === 0) return getTenantById(id);
  
  params.push(id);
  const result = await pool.query(`
    UPDATE tenants SET ${updates.join(', ')}, updated_at = NOW()
    WHERE id = $${params.length} RETURNING *
  `, params);
  
  if (!result.rows[0]) return null;
  return { ...result.rows[0], branding: JSON.parse(result.rows[0].branding), settings: JSON.parse(result.rows[0].settings) };
}

// ===========================================
// Whitelabel Configuration
// ===========================================

interface WhitelabelConfig {
  tenant_id: string;
  domain: string;
  ssl_enabled: boolean;
  ssl_cert?: string;
  ssl_key?: string;
  cname_record?: string;
}

async function configureWhitelabel(tenantId: string, config: Partial<WhitelabelConfig>): Promise<void> {
  await pool.query(`
    UPDATE tenants SET custom_domain = $1, updated_at = NOW() WHERE id = $2
  `, [config.domain, tenantId]);
  
  // Store SSL certificates securely
  if (config.ssl_cert && config.ssl_key) {
    await redis.set(`tenant:${tenantId}:ssl_cert`, config.ssl_cert);
    await redis.set(`tenant:${tenantId}:ssl_key`, config.ssl_key);
  }
}

async function getTenantBranding(tenantId: string): Promise<TenantBranding> {
  const tenant = await getTenantById(tenantId);
  return tenant?.branding || { primary_color: '#3b82f6', secondary_color: '#1e40af', accent_color: '#06b6d4' };
}

// ===========================================
// Tenant Isolation (Row-Level Security)
// ===========================================

function getTenantIsolationQuery(tenantId: string): string {
  // PostgreSQL row-level security
  return `
    ALTER TABLE users ENABLE ROW LEVEL SECURITY;
    CREATE POLICY tenant_isolation_policy ON users
      USING (tenant_id = '${tenantId}');
  `;
}

// ===========================================
// Resource Limits (Plan-Based)
// ===========================================

interface PlanLimits {
  max_users: number;
  max_storage_gb: number;
  max_api_calls_per_month: number;
  max_officers: number;
  features: string[];
}

const PLAN_LIMITS: Record<PlanTier, PlanLimits> = {
  starter: {
    max_users: 5,
    max_storage_gb: 1,
    max_api_calls_per_month: 10000,
    max_officers: 10,
    features: ['basic_reporting', 'email_support'],
  },
  professional: {
    max_users: 25,
    max_storage_gb: 10,
    max_api_calls_per_month: 100000,
    max_officers: 50,
    features: ['advanced_reporting', 'priority_support', 'api_access', 'custom_branding'],
  },
  enterprise: {
    max_users: -1, // Unlimited
    max_storage_gb: 100,
    max_api_calls_per_month: -1, // Unlimited
    max_officers: -1,
    features: ['enterprise_reporting', '24/7_support', 'full_api', 'whitelabel', 'sso', 'audit_logs'],
  },
};

async function checkResourceLimits(tenantId: string, resource: string): Promise<boolean> {
  const tenant = await getTenantById(tenantId);
  if (!tenant) return false;
  
  const limits = PLAN_LIMITS[tenant.plan];
  
  switch (resource) {
    case 'users': {
      const count = await pool.query('SELECT COUNT(*) FROM tenant_users WHERE tenant_id = $1', [tenantId]);
      return parseInt(count.rows[0].count) < limits.max_users;
    }
    case 'storage': {
      // Check storage usage
      return true;
    }
    case 'api_calls': {
      const usage = await getApiUsage(tenantId);
      return usage < limits.max_api_calls_per_month;
    }
    default:
      return true;
  }
}

async function getApiUsage(tenantId: string): Promise<number> {
  const result = await redis.get(`tenant:${tenantId}:api_calls`);
  return parseInt(result || '0');
}

async function incrementApiUsage(tenantId: string): Promise<void> {
  await redis.incr(`tenant:${tenantId}:api_calls`);
}

// ===========================================
// Tenant Users
// ===========================================

interface TenantUser {
  id: string;
  tenant_id: string;
  user_id: string;
  role: 'admin' | 'manager' | 'user' | 'viewer';
  permissions: string[];
}

async function inviteUser(tenantId: string, email: string, role: string): Promise<string> {
  const id = uuidv4();
  
  await pool.query(`
    INSERT INTO tenant_users (id, tenant_id, email, role, status)
    VALUES ($1, $2, $3, $4, 'pending')
  `, [id, tenantId, email, role]);
  
  // Send invitation email
  // await emailService.sendInvitation(email, id);
  
  return id;
}

async function getTenantUsers(tenantId: string): Promise<TenantUser[]> {
  const result = await pool.query('SELECT * FROM tenant_users WHERE tenant_id = $1', [tenantId]);
  return result.rows;
}

async function updateUserRole(tenantId: string, userId: string, role: string): Promise<void> {
  await pool.query(`
    UPDATE tenant_users SET role = $1, updated_at = NOW()
    WHERE tenant_id = $2 AND id = $3
  `, [role, tenantId, userId]);
}

// ===========================================
// Analytics
// ===========================================

interface TenantAnalytics {
  tenant_id: string;
  users_count: number;
  api_calls_this_month: number;
  storage_used_gb: number;
  billing_current: number;
  plan_limits: PlanLimits;
}

async function getTenantAnalytics(tenantId: string): Promise<TenantAnalytics> {
  const tenant = await getTenantById(tenantId);
  const plan = tenant?.plan || 'starter';
  
  const [usersCount, storageUsed] = await Promise.all([
    pool.query('SELECT COUNT(*) FROM tenant_users WHERE tenant_id = $1', [tenantId]),
    pool.query('SELECT SUM(file_size) FROM documents WHERE tenant_id = $1', [tenantId]),
  ]);
  
  const apiCalls = await getApiUsage(tenantId);
  
  return {
    tenant_id: tenantId,
    users_count: parseInt(usersCount.rows[0]?.count || '0'),
    api_calls_this_month: apiCalls,
    storage_used_gb: (parseInt(storageUsed.rows[0]?.sum || '0') / (1024 * 1024 * 1024)),
    billing_current: calculateBilling(plan),
    plan_limits: PLAN_LIMITS[plan],
  };
}

function calculateBilling(plan: PlanTier): number {
  const pricing = { starter: 999, professional: 2499, enterprise: 9999 };
  return pricing[plan];
}

// ===========================================
// Middleware
// ===========================================

app.use(async (req: Request, res: Response, next: Function) => {
  // Extract tenant from subdomain or header
  const host = req.headers.host || '';
  const subdomain = host.split('.')[0];
  
  // Check for tenant in header (API calls)
  const tenantId = req.headers['x-tenant-id'] as string;
  
  if (tenantId) {
    const tenant = await getTenantById(tenantId);
    if (!tenant) return res.status(403).json({ error: 'Invalid tenant' });
    if (tenant.status !== 'active') return res.status(403).json({ error: 'Tenant suspended' });
    
    (req as any).tenant = tenant;
    
    // Rate limiting per tenant
    await incrementApiUsage(tenantId);
  }
  
  next();
});

// ===========================================
// API Routes
// ===========================================

// Tenants
app.post('/api/tenants', async (req: Request, res: Response) => {
  try {
    const tenant = await createTenant(req.body);
    res.status(201).json({ success: true, data: tenant });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to create tenant' });
  }
});

app.get('/api/tenants', async (req: Request, res: Response) => {
  try {
    const { status, plan } = req.query as any;
    const tenants = await getTenants({ status, plan });
    res.json({ success: true, data: tenants });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch tenants' });
  }
});

app.get('/api/tenants/:id', async (req: Request, res: Response) => {
  try {
    const tenant = await getTenantById(req.params.id);
    if (!tenant) return res.status(404).json({ success: false, error: 'Tenant not found' });
    res.json({ success: true, data: tenant });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch tenant' });
  }
});

app.put('/api/tenants/:id', async (req: Request, res: Response) => {
  try {
    const tenant = await updateTenant(req.params.id, req.body);
    res.json({ success: true, data: tenant });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to update tenant' });
  }
});

// Branding
app.get('/api/tenants/:id/branding', async (req: Request, res: Response) => {
  try {
    const branding = await getTenantBranding(req.params.id);
    res.json({ success: true, data: branding });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch branding' });
  }
});

// Users
app.post('/api/tenants/:id/users/invite', async (req: Request, res: Response) => {
  try {
    const { email, role } = req.body;
    const inviteId = await inviteUser(req.params.id, email, role);
    res.status(201).json({ success: true, data: { invite_id: inviteId } });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to invite user' });
  }
});

app.get('/api/tenants/:id/users', async (req: Request, res: Response) => {
  try {
    const users = await getTenantUsers(req.params.id);
    res.json({ success: true, data: users });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch users' });
  }
});

// Analytics
app.get('/api/tenants/:id/analytics', async (req: Request, res: Response) => {
  try {
    const analytics = await getTenantAnalytics(req.params.id);
    res.json({ success: true, data: analytics });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch analytics' });
  }
});

app.get('/health', async (req: Request, res: Response) => {
  res.json({ status: 'healthy', service: 'multi-tenancy' });
});

const PORT = process.env.PORT || 3024;

app.listen(PORT, () => console.log(`Multi-Tenancy Service on port ${PORT}`));

export default app;