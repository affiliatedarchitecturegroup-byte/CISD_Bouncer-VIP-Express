// ===========================================
// Mobile Performance Service
// Phase 2.5 - Optimization
// ===========================================

import express, { Request, Response } from 'express';
import { Pool } from 'pg';
import sharp from 'sharp';

const app = express();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
app.use(express.json());

// ===========================================
// Image Optimization
// ===========================================

interface ImageTransform {
  width?: number;
  height?: number;
  quality?: number;
  format?: 'jpeg' | 'png' | 'webp' | 'avif';
}

export async function optimizeImage(
  inputBuffer: Buffer,
  transform: ImageTransform
): Promise<Buffer> {
  let pipeline = sharp(inputBuffer);
  
  if (transform.width || transform.height) {
    pipeline = pipeline.resize(transform.width, transform.height, {
      fit: 'cover',
      position: 'center',
    });
  }
  
  const format = transform.format || 'webp';
  const quality = transform.quality || 80;
  
  if (format === 'jpeg') {
    pipeline = pipeline.jpeg({ quality });
  } else if (format === 'png') {
    pipeline = pipeline.png({ quality });
  } else if (format === 'webp') {
    pipeline = pipeline.webp({ quality });
  } else if (format === 'avif') {
    pipeline = pipeline.avif({ quality });
  }
  
  return pipeline.toBuffer();
}

export async function generateThumbnail(
  inputBuffer: Buffer,
  size: number = 200
): Promise<Buffer> {
  return optimizeImage(inputBuffer, { width: size, height: size, format: 'webp', quality: 70 });
}

// ===========================================
// Lazy Loading
// ===========================================

interface LazyLoadConfig {
  threshold?: number;
  container?: string;
  placeholder?: string;
}

const defaultLazyConfig: LazyLoadConfig = {
  threshold: 200,
  container: 'window',
  placeholder: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
};

// ===========================================
// Bundle Splitting
// ===========================================

interface BundleEntry {
  name: string;
  chunk: string[];
  size: number;
}

const bundleConfig: BundleEntry[] = [
  { name: 'core', chunk: ['validation', 'error-handler'], size: 0 },
  { name: 'auth', chunk: ['auth', 'biometric-auth'], size: 0 },
  { name: 'booking', chunk: ['booking', 'scheduling'], size: 0 },
  { name: 'map', chunk: ['map', 'location'], size: 0 },
];

function getBundleChunks(module: string): string[] {
  for (const entry of bundleConfig) {
    if (entry.chunk.includes(module)) {
      return entry.chunk;
    }
  }
  return [module];
}

// ===========================================
// Cache Headers
// ===========================================

interface CacheConfig {
  maxAge: number;
  staleWhileRevalidate?: number;
  mustRevalidate?: boolean;
}

function getCacheHeaders(config: CacheConfig): Record<string, string> {
  const headers: Record<string, string> = {
    'Cache-Control': `public, max-age=${config.maxAge}`,
  };
  
  if (config.staleWhileRevalidate) {
    headers['Cache-Control'] += `, stale-while-revalidate=${config.staleWhileRevalidate}`;
  }
  if (config.mustRevalidate) {
    headers['Cache-Control'] += ', must-revalidate';
  }
  
  return headers;
}

// ===========================================
// Performance Metrics
// ===========================================

interface PerformanceMetrics {
  fcp?: number; // First Contentful Paint
  lcp?: number; // Largest Contentful Paint
  fid?: number; // First Input Delay
  cls?: number; // Cumulative Layout Shift
  ttfb?: number; // Time to First Byte
}

async function recordMetrics(userId: string, metrics: PerformanceMetrics): Promise<void> {
  await pool.query(`
    INSERT INTO performance_metrics (user_id, fcp, lcp, fid, cls, ttfb, recorded_at)
    VALUES ($1, $2, $3, $4, $5, $6, NOW())
  `, [userId, metrics.fcp, metrics.lcp, metrics.fid, metrics.cls, metrics.ttfb]);
}

async function getAverageMetrics(userId: string): Promise<PerformanceMetrics> {
  const result = await pool.query(`
    SELECT 
      AVG(fcp) as fcp,
      AVG(lcp) as lcp,
      AVG(fid) as fid,
      AVG(cls) as cls,
      AVG(ttfb) as ttfb
    FROM performance_metrics
    WHERE user_id = $1 AND recorded_at > NOW() - INTERVAL '7 days'
  `, [userId]);
  
  return result.rows[0];
}

// ===========================================
// API Routes
// ===========================================

app.post('/api/optimize/image', async (req: Request, res: Response) => {
  const { image, transform } = req.body;
  const optimized = await optimizeImage(Buffer.from(image, 'base64'), transform);
  res.json({ success: true, data: optimized.toString('base64') });
});

app.post('/api/thumbnail', async (req: Request, res: Response) => {
  const { image, size } = req.body;
  const thumbnail = await generateThumbnail(Buffer.from(image, 'base64'), size);
  res.json({ success: true, data: thumbnail.toString('base64') });
});

app.get('/api/bundle/:module', (req: Request, res: Response) => {
  const chunks = getBundleChunks(req.params.module);
  res.json({ success: true, data: { chunks } });
});

app.get('/api/cache/:type', (req: Request, res: Response) => {
  const config = req.params.type === 'static' 
    ? { maxAge: 31536000 }
    : req.params.type === 'api'
    ? { maxAge: 60 }
    : { maxAge: 300 };
  
  res.set(getCacheHeaders(config));
  res.json({ success: true });
});

app.post('/api/metrics', async (req: Request, res: Response) => {
  const { user_id, metrics } = req.body;
  await recordMetrics(user_id, metrics);
  res.json({ success: true });
});

app.get('/api/metrics/:userId', async (req: Request, res: Response) => {
  const metrics = await getAverageMetrics(req.params.userId);
  res.json({ success: true, data: metrics });
});

app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'healthy', service: 'mobile-performance' });
});

const PORT = process.env.PORT || 3204;
app.listen(PORT, () => console.log(`Mobile Performance Service on port ${PORT}`));

export default app;