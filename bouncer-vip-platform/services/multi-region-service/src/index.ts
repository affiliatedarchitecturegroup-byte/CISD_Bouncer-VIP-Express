// ===========================================
// Multi-Region Service
// Geo-distributed database, regional routing
// ===========================================

import express, { Request, Response } from 'express';
import { Pool } from 'pg';
import Redis from 'ioredis';
import { v4 as uuidv4 } from 'uuid';
import axios from 'axios';

const app = express();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

app.use(express.json());

// ===========================================
// Types
// ===========================================

type Region = 'za' | 'ng' | 'ke' | 'bw' | 'na' | 'zw' | 'mz';

interface RegionConfig {
  code: Region;
  name: string;
  timezone: string;
  database: string;
  currency: string;
  language: string;
}

const REGIONS: Record<Region, RegionConfig> = {
  za: { code: 'za', name: 'South Africa', timezone: 'Africa/Johannesburg', database: 'bouncer_za', currency: 'ZAR', language: 'en' },
  ng: { code: 'ng', name: 'Nigeria', timezone: 'Africa/Lagos', database: 'bouncer_ng', currency: 'NGN', language: 'en' },
  ke: { code: 'ke', name: 'Kenya', timezone: 'Africa/Nairobi', database: 'bouncer_ke', currency: 'KES', language: 'en' },
  bw: { code: 'bw', name: 'Botswana', timezone: 'Africa/Gaborone', database: 'bouncer_bw', currency: 'BWP', language: 'en' },
  na: { code: 'na', name: 'Namibia', timezone: 'Africa/Windhoek', database: 'bouncer_na', currency: 'NAD', language: 'en' },
  zw: { code: 'zw', name: 'Zimbabwe', timezone: 'Africa/Harare', database: 'bouncer_zw', currency: 'ZWL', language: 'en' },
  mz: { code: 'mz', name: 'Mozambique', timezone: 'Africa/Maputo', database: 'bouncer_mz', currency: 'MZN', language: 'pt' },
};

// ===========================================
// Regional Routing
// ===========================================

class RegionalRouter {
  private regionPools: Map<Region, Pool>;

  constructor() {
    this.regionPools = new Map();
    this.initializeRegionPools();
  }

  private initializeRegionPools(): void {
    // Initialize connection pools for each region
    for (const [code, config] of Object.entries(REGIONS)) {
      const connectionString = process.env[`DATABASE_URL_${code.toUpperCase()}`] || process.env.DATABASE_URL;
      if (connectionString) {
        this.regionPools.set(code as Region, new Pool({ connectionString }));
      }
    }
  }

  getRegionPool(region: Region): Pool | null {
    return this.regionPools.get(region) || pool;
  }

  getRegionForUser(userId: string): Region {
    // Determine user's region based on their profile
    // Default to South Africa
    return 'za';
  }

  getRegionForVenue(venueId: string): Region {
    // Determine venue's region
    return 'za';
  }

  async routeQuery<T>(region: Region, query: string, params?: any[]): Promise<T[]> {
    const regionPool = this.getRegionPool(region);
    const result = await regionPool.query(query, params);
    return result.rows;
  }
}

const router = new RegionalRouter();

// ===========================================
// Regional Data Sync
// ===========================================

class DataSync {
  async syncBetweenRegions(sourceRegion: Region, targetRegion: Region, table: string): Promise<void> {
    const sourcePool = router.getRegionPool(sourceRegion);
    const targetPool = router.getRegionPool(targetRegion);

    // Get latest sync timestamp
    const syncLog = await sourcePool.query(`
      SELECT last_synced_at FROM region_sync_log 
      WHERE table_name = $1 AND target_region = $2
      ORDER BY last_synced_at DESC LIMIT 1
    `, [table, targetRegion]);

    let query = `SELECT * FROM ${table}`;
    const params: any[] = [];

    if (syncLog.rows[0]?.last_synced_at) {
      query += ` WHERE updated_at > $1`;
      params.push(syncLog.rows[0].last_synced_at);
    }

    const data = await sourcePool.query(query, params);

    for (const row of data.rows) {
      await targetPool.query(`
        INSERT INTO ${table} (id, ${Object.keys(row).filter(k => k !== 'id').join(', ')})
        VALUES ($1, ${Object.keys(row).filter(k => k !== 'id').map((_, i) => `$${i + 2}`).join(', ')})
        ON CONFLICT (id) DO UPDATE SET
          ${Object.keys(row).filter(k => k !== 'id').map(k => `${k} = $${k}`).join(', ')}
      `, [row.id, ...Object.values(row).filter((_, i) => Object.keys(row)[i] !== 'id')]);
    }

    // Log sync
    await sourcePool.query(`
      INSERT INTO region_sync_log (id, table_name, source_region, target_region, records_synced, synced_at)
      VALUES ($1, $2, $3, $4, $5, NOW())
    `, [uuidv4(), table, sourceRegion, targetRegion, data.rows.length]);
  }

  async scheduleSync(sourceRegion: Region, targetRegion: Region, table: string): Promise<void> {
    await pool.query(`
      INSERT INTO scheduled_syncs (id, source_region, target_region, table_name, status)
      VALUES ($1, $2, $3, $4, 'scheduled')
    `, [uuidv4(), sourceRegion, targetRegion, table]);
  }
}

const dataSync = new DataSync();

// ===========================================
// Currency & Localization
// ===========================================

function convertCurrency(amount: number, fromCurrency: string, toCurrency: string): number {
  const rates: Record<string, number> = {
    ZAR: 1,
    NGN: 26.5,
    KES: 0.12,
    BWP: 1.2,
    NAD: 1,
    ZWL: 0.035,
    MZN: 0.22,
  };

  const inZAR = amount / (rates[fromCurrency] || 1);
  return inZAR * (rates[toCurrency] || 1);
}

function formatForRegion(region: Region, value: number, type: 'currency' | 'date'): string {
  const config = REGIONS[region];
  
  if (type === 'currency') {
    return new Intl.NumberFormat(config.language, {
      style: 'currency',
      currency: config.currency,
    }).format(value);
  }

  return new Intl.DateTimeFormat(config.language, {
    timeZone: config.timezone,
  }).format(new Date(value));
}

// ===========================================
// Geo-Routing Middleware
// ===========================================

function getClientRegion(req: Request): Region {
  // Check header first
  const headerRegion = req.headers['x-region'] as Region;
  if (headerRegion && REGIONS[headerRegion]) {
    return headerRegion;
  }

  // Check user's IP and geolocate
  // Default to South Africa
  return 'za';
}

async function regionalMiddleware(req: Request, res: Response, next: NextFunction) {
  req.headers['x-region'] = getClientRegion(req);
  next();
}

// ===========================================
// Health & Monitoring
// ===========================================

async function getRegionHealth(): Promise<Record<Region, { status: string; latency: number }>> {
  const health: Record<string, any> = {};

  for (const [code, config] of Object.entries(REGIONS)) {
    try {
      const start = Date.now();
      const regionPool = router.getRegionPool(code as Region);
      await regionPool.query('SELECT 1');
      health[code] = { status: 'healthy', latency: Date.now() - start };
    } catch (error) {
      health[code] = { status: 'unhealthy', latency: -1 };
    }
  }

  return health;
}

// ===========================================
// API Routes
// ===========================================

app.get('/api/regions', (req: Request, res: Response) => {
  res.json({ success: true, data: Object.values(REGIONS) });
});

app.get('/api/regions/:code', (req: Request, res: Response) => {
  const region = REGIONS[req.params.code as Region];
  if (!region) return res.status(404).json({ error: 'Region not found' });
  res.json({ success: true, data: region });
});

app.post('/api/sync', async (req: Request, res: Response) => {
  try {
    const { source, target, table } = req.body;
    await dataSync.syncBetweenRegions(source, target, table);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Sync failed' });
  }
});

app.get('/api/health', async (req: Request, res: Response) => {
  const health = await getRegionHealth();
  res.json({ success: true, data: health });
});

app.get('/api/convert', (req: Request, res: Response) => {
  const { amount, from, to } = req.query;
  const converted = convertCurrency(parseFloat(amount as string), from as string, to as string);
  res.json({ success: true, data: { original: amount, converted } });
});

app.get('/health', async (req: Request, res: Response) => {
  res.json({ status: 'healthy', service: 'multi-region' });
});

const PORT = process.env.PORT || 3080;

app.listen(PORT, () => console.log(`Multi-Region Service on port ${PORT}`));

export default app;