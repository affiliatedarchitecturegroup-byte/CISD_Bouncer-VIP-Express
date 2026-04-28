// ===========================================
// Query Optimizer Service
// Phase 1.3 - Performance and caching
// ===========================================

import express, { Request, Response } from 'express';
import { Pool, PoolConfig } from 'pg';
import Redis from 'ioredis';

const app = express();

const poolConfig: PoolConfig = {
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
};

const pool = new Pool(poolConfig);
const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

app.use(express.json());

// ===========================================
// Query Cache
// ===========================================

interface CacheOptions {
  ttl?: number; // Time to live in seconds
  skipCache?: boolean;
}

interface CachedQuery {
  data: any;
  timestamp: number;
  ttl: number;
}

const DEFAULT_TTL = 300; // 5 minutes

async function cacheQuery(key: string, queryFn: () => Promise<any>, options: CacheOptions = {}): Promise<any> {
  const { ttl = DEFAULT_TTL, skipCache } = options;

  // Try cache first if not skipped
  if (!skipCache) {
    const cached = await redis.get(`query:${key}`);
    if (cached) {
      return JSON.parse(cached);
    }
  }

  // Execute query
  const startTime = Date.now();
  const result = await queryFn();
  const duration = Date.now() - startTime;

  // Cache results
  if (!skipCache && duration > 50) {
    await redis.setex(`query:${key}`, ttl, JSON.stringify(result));
  }

  // Log slow queries
  if (duration > 1000) {
    console.warn(`[SLOW_QUERY] ${key} took ${duration}ms`);
  }

  return result;
}

// ===========================================
// Prepared Statements
// ===========================================

const preparedStatements = new Map<string, string>();

export function registerPreparedStatement(name: string, sql: string): void {
  preparedStatements.set(name, sql);
}

// ===========================================
// Query Builder with Optimization
// ===========================================

interface QueryOptions {
  cache?: boolean;
  cacheTTL?: number;
  preparedStatement?: string;
}

export async function executeQuery(sql: string, params: any[] = [], options: QueryOptions = {}): Promise<any[]> {
  const { cache, cacheTTL, preparedStatement } = options;
  const cacheKey = `${sql}:${JSON.stringify(params)}`;

  if (cache) {
    return cacheQuery(cacheKey, () => pool.query(sql, params).then(r => r.rows), { ttl: cacheTTL });
  }

  const startTime = Date.now();
  const result = await pool.query(sql, params);
  const duration = Date.now() - startTime;

  // Log query performance
  console.log(`[QUERY] ${sql.substring(0, 50)}... (${duration}ms)`);

  return result.rows;
}

// ===========================================
// Pagination Helper
// ===========================================

interface PaginateOptions {
  page: number;
  limit: number;
  maxLimit?: number;
}

interface PaginatedResult<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasMore: boolean;
  };
}

export async function paginate<T>(
  sql: string, 
  params: any[], 
  options: PaginateOptions
): Promise<PaginatedResult<T>> {
  const { page = 1, limit = 20, maxLimit = 100 } = options;
  const safeLimit = Math.min(limit, maxLimit);
  const offset = (page - 1) * safeLimit;

  // Get total count - optimized to use COUNT(*)
  const countSql = sql.toUpperCase().includes('JOIN') 
    ? `SELECT COUNT(*) as total FROM (${sql}) as count_subquery`
    : `SELECT COUNT(*) as total${sql.substring(sql.toUpperCase().indexOf('FROM'))}`;
  
  const countParams = params.slice();
  const countResult = await pool.query(countSql, countParams);
  const total = parseInt(countResult.rows[0]?.total || '0');

  // Get paginated data
  const dataSql = `${sql} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
  const dataParams = [...params, safeLimit, offset];
  const dataResult = await pool.query(dataSql, dataParams);

  return {
    data: dataResult.rows,
    pagination: {
      page,
      limit: safeLimit,
      total,
      totalPages: Math.ceil(total / safeLimit),
      hasMore: offset + safeLimit < total,
    },
  };
}

// ===========================================
// Connection Pool Status
// ===========================================

export async function getPoolStatus(): Promise<any> {
  const { totalCount, idleCount, waitingCount } = pool as any;
  return {
    total: totalCount,
    idle: idleCount,
    waiting: waitingCount,
    max: poolConfig.max,
  };
}

// ===========================================
// Cache Invalidation
// ===========================================

async function invalidatePattern(pattern: string): Promise<number> {
  const keys = await redis.keys(`query:${pattern}*`);
  if (keys.length > 0) {
    return redis.del(...keys);
  }
  return 0;
}

// ===========================================
// API Routes
// ===========================================

app.get('/api/pool/status', async (req: Request, res: Response) => {
  const status = await getPoolStatus();
  res.json({ success: true, data: status });
});

app.post('/api/cache/invalidate', async (req: Request, res: Response) => {
  const { pattern } = req.body;
  const invalidated = await invalidatePattern(pattern || '*');
  res.json({ success: true, data: { invalidated } });
});

app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'healthy', service: 'query-optimizer' });
});

const PORT = process.env.PORT || 3087;
app.listen(PORT, () => console.log(`Query Optimizer Service on port ${PORT}`));

export default app;