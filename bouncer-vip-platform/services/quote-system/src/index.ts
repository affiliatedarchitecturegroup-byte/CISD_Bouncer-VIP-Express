// ===========================================
// Quote System Service
// Dynamic pricing, quotes, and proposals
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
// Pricing Engine
// ===========================================

interface PricingFactors {
  venueSize: 'small' | 'medium' | 'large' | 'enterprise';
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  duration: number; // hours
  dayOfWeek: number; // 0-6
  isHoliday: boolean;
  officerGrade: 'A' | 'B' | 'C' | 'D' | 'E';
  equipmentNeeded: string[];
  emergency: boolean;
}

const BASE_RATES = {
  A: 250, B: 200, C: 175, D: 150, E: 125
};

const SIZE_MULTIPLIERS = {
  small: 1, medium: 1.5, large: 2, enterprise: 3
};

const RISK_MULTIPLIERS = {
  low: 1, medium: 1.25, high: 1.5, critical: 2
};

class PricingEngine {
  calculateQuote(factors: PricingFactors): {
    baseRate: number;
    subtotal: number;
    equipment: number;
    rushFee: number;
    holidayFee: number;
    total: number;
    breakdown: any;
  } {
    // Base rate per hour
    const baseRate = BASE_RATES[factors.officerGrade];
    
    // Calculate subtotal
    let subtotal = baseRate * factors.duration;
    subtotal *= SIZE_MULTIPLIERS[factors.venueSize];
    subtotal *= RISK_MULTIPLIERS[factors.riskLevel];
    
    // Weekend surcharge
    if (factors.dayOfWeek === 0 || factors.dayOfWeek === 6) {
      subtotal *= 1.25; // 25% weekend surcharge
    }
    
    // Equipment costs
    const equipmentCosts: Record<string, number> = {
      radio: 25, flashlight: 15, vest: 20, 
      baton: 15, handcuffs: 10, radio_scanner: 35,
      body_camera: 50, vehicle: 150
    };
    
    let equipment = 0;
    for (const item of factors.equipmentNeeded) {
      equipment += equipmentCosts[item] || 0;
    }
    equipment *= factors.duration;
    
    // Holiday fee (50% extra)
    let holidayFee = 0;
    if (factors.isHoliday) {
      holidayFee = subtotal * 0.5;
    }
    
    // Emergency rush fee (25% extra)
    let rushFee = 0;
    if (factors.emergency) {
      rushFee = subtotal * 0.25;
    }
    
    const total = subtotal + equipment + holidayFee + rushFee;
    
    return {
      baseRate,
      subtotal,
      equipment,
      rushFee,
      holidayFee,
      total: Math.round(total * 100) / 100,
      breakdown: {
        baseRate,
        duration: factors.duration,
        sizeMultiplier: SIZE_MULTIPLIERS[factors.venueSize],
        riskMultiplier: RISK_MULTIPLIERS[factors.riskLevel],
        weekendSurcharge: factors.dayOfWeek === 0 || factors.dayOfWeek === 6 ? 1.25 : 1,
        equipmentItems: factors.equipmentNeeded,
        isHoliday: factors.isHoliday,
        isEmergency: factors.emergency,
      }
    };
  }
  
  // Get historical pricing for comparison
  async getHistoricalAverage(venueId: string, serviceType: string): Promise<number> {
    const result = await pool.query(`
      SELECT AVG(total_amount) as avg 
      FROM quotes 
      WHERE venue_id = $1 AND status = 'accepted'
      ORDER BY created_at DESC LIMIT 30
    `, [venueId]);
    return result.rows[0]?.avg || 0;
  }
}

const pricingEngine = new PricingEngine();

// ===========================================
// Quote Management
// ===========================================

interface Quote {
  id: string;
  venue_id: string;
  client_name: string;
  client_email: string;
  service_type: string;
  status: 'draft' | 'sent' | 'viewed' | 'accepted' | 'rejected' | 'expired';
  pricing: any;
  total: number;
  valid_until: string;
  created_at: string;
  accepted_at?: string;
}

async function createQuote(data: {
  venue_id: string;
  client_name: string;
  client_email: string;
  service_type: string;
  factors: PricingFactors;
}): Promise<Quote> {
  const id = uuidv4();
  const pricing = pricingEngine.calculateQuote(data.factors);
  const validUntil = new Date();
  validUntil.setDate(validUntil.getDate() + 30); // 30 days validity
  
  const [quote] = await pool.query(`
    INSERT INTO quotes (id, venue_id, client_name, client_email, service_type, pricing, total, valid_until, status)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'draft')
    RETURNING *
  `, [id, data.venue_id, data.client_name, data.client_email, data.service_type, JSON.stringify(pricing), pricing.total, validUntil]);
  
  return quote;
}

async function getQuotes(filters?: {
  venue_id?: string;
  status?: string;
  from_date?: string;
  to_date?: string;
}): Promise<Quote[]> {
  let query = 'SELECT * FROM quotes WHERE 1=1';
  const params: any[] = [];
  
  if (filters?.venue_id) {
    params.push(filters.venue_id);
    query += ` AND venue_id = $${params.length}`;
  }
  if (filters?.status) {
    params.push(filters.status);
    query += ` AND status = $${params.length}`;
  }
  if (filters?.from_date) {
    params.push(filters.from_date);
    query += ` AND created_at >= $${params.length}`;
  }
  if (filters?.to_date) {
    params.push(filters.to_date);
    query += ` AND created_at <= $${params.length}`;
  }
  
  query += ' ORDER BY created_at DESC';
  const result = await pool.query(query, params);
  return result.rows.map(r => ({ ...r, pricing: JSON.parse(r.pricing) }));
}

async function acceptQuote(quoteId: string): Promise<void> {
  await pool.query(`
    UPDATE quotes SET status = 'accepted', accepted_at = NOW(), updated_at = NOW()
    WHERE id = $1
  `, [quoteId]);
  
  // Convert to booking
  const quote = await pool.query('SELECT * FROM quotes WHERE id = $1', [quoteId]);
  // await createBookingFromQuote(quote.rows[0]);
}

async function rejectQuote(quoteId: string, reason?: string): Promise<void> {
  await pool.query(`
    UPDATE quotes SET status = 'rejected', rejection_reason = $1, updated_at = NOW()
    WHERE id = $2
  `, [reason, quoteId]);
}

// ===========================================
// Quote Templates
// ===========================================

interface QuoteTemplate {
  id: string;
  name: string;
  service_type: string;
  default_factors: PricingFactors;
}

const TEMPLATES: QuoteTemplate[] = [
  {
    id: 'standard_guard',
    name: 'Standard Guard Service',
    service_type: 'standard',
    default_factors: {
      venueSize: 'medium',
      riskLevel: 'medium',
      duration: 8,
      dayOfWeek: new Date().getDay(),
      isHoliday: false,
      officerGrade: 'C',
      equipmentNeeded: ['radio', 'flashlight'],
      emergency: false,
    }
  },
  {
    id: 'event_security',
    name: 'Event Security',
    service_type: 'event',
    default_factors: {
      venueSize: 'large',
      riskLevel: 'high',
      duration: 6,
      dayOfWeek: 6,
      isHoliday: false,
      officerGrade: 'B',
      equipmentNeeded: ['radio', 'flashlight', 'vest', 'body_camera'],
      emergency: false,
    }
  },
  {
    id: 'vip_protection',
    name: 'VIP Protection',
    service_type: 'vip',
    default_factors: {
      venueSize: 'small',
      riskLevel: 'critical',
      duration: 4,
      dayOfWeek: new Date().getDay(),
      isHoliday: false,
      officerGrade: 'A',
      equipmentNeeded: ['radio', 'body_camera', 'vehicle'],
      emergency: false,
    }
  },
];

// ===========================================
// Analytics
// ===========================================

async function getQuoteAnalytics(): Promise<{
  total_quotes: number;
  accepted: number;
  rejected: number;
  pending: number;
  acceptance_rate: number;
  average_value: number;
  by_service_type: Record<string, number>;
}> {
  const [total, accepted, rejected, pending, avgValue, byType] = await Promise.all([
    pool.query('SELECT COUNT(*) as count FROM quotes'),
    pool.query("SELECT COUNT(*) as count FROM quotes WHERE status = 'accepted'"),
    pool.query("SELECT COUNT(*) as count FROM quotes WHERE status = 'rejected'"),
    pool.query("SELECT COUNT(*) as count FROM quotes WHERE status IN ('draft', 'sent')"),
    pool.query('SELECT AVG(total) as avg FROM quotes'),
    pool.query('SELECT service_type, COUNT(*) as count FROM quotes GROUP BY service_type'),
  ]);
  
  const totalCount = parseInt(total.rows[0]?.count || '0');
  const acceptedCount = parseInt(accepted.rows[0]?.count || '0');
  
  return {
    total_quotes: totalCount,
    accepted: acceptedCount,
    rejected: parseInt(rejected.rows[0]?.count || '0'),
    pending: parseInt(pending.rows[0]?.count || '0'),
    acceptance_rate: totalCount > 0 ? Math.round((acceptedCount / totalCount) * 100) : 0,
    average_value: parseFloat(avgValue.rows[0]?.avg || '0'),
    by_service_type: Object.fromEntries(byType.rows.map((r: any) => [r.service_type, parseInt(r.count)])),
  };
}

// ===========================================
// API Routes
// ===========================================

app.post('/api/quotes/calculate', async (req: Request, res: Response) => {
  try {
    const { factors } = req.body;
    const pricing = pricingEngine.calculateQuote(factors);
    res.json({ success: true, data: pricing });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Calculation failed' });
  }
});

app.post('/api/quotes', async (req: Request, res: Response) => {
  try {
    const quote = await createQuote(req.body);
    res.status(201).json({ success: true, data: quote });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to create quote' });
  }
});

app.get('/api/quotes', async (req: Request, res: Response) => {
  try {
    const quotes = await getQuotes(req.query as any);
    res.json({ success: true, data: quotes });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch quotes' });
  }
});

app.get('/api/quotes/:id', async (req: Request, res: Response) => {
  try {
    const quotes = await getQuotes({ status: req.params.id as any });
    res.json({ success: true, data: quotes[0] });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch quote' });
  }
});

app.post('/api/quotes/:id/accept', async (req: Request, res: Response) => {
  try {
    await acceptQuote(req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to accept quote' });
  }
});

app.post('/api/quotes/:id/reject', async (req: Request, res: Response) => {
  try {
    const { reason } = req.body;
    await rejectQuote(req.params.id, reason);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to reject quote' });
  }
});

app.get('/api/templates', async (req: Request, res: Response) => {
  res.json({ success: true, data: TEMPLATES });
});

app.get('/api/analytics', async (req: Request, res: Response) => {
  try {
    const analytics = await getQuoteAnalytics();
    res.json({ success: true, data: analytics });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch analytics' });
  }
});

app.get('/health', async (req: Request, res: Response) => {
  res.json({ status: 'healthy', service: 'quote-system' });
});

const PORT = process.env.PORT || 3050;

app.listen(PORT, () => console.log(`Quote System Service on port ${PORT}`));

export default app;