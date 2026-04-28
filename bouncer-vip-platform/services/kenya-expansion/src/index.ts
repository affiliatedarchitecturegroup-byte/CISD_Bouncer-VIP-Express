// ===========================================
// Kenya Expansion Service
// M-Pesa, local compliance, features
// ===========================================

import express, { Request, Response } from 'express';
import { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';

const app = express();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
app.use(express.json());

// Kenyan Shilling
const KENYA_CURRENCY = { code: 'KES', symbol: 'KSh', name: 'Kenyan Shilling', subunits: 100 };

function formatKenyaShilling(cents: number): string {
  const shillings = cents / 100;
  return `KSh ${shillings.toLocaleString('en-KE', { minimumFractionDigits: 2 })}`;
}

// M-Pesa Integration
class MPesaIntegration {
  private consumerKey: string;
  private consumerSecret: string;
  private shortCode: string;

  constructor() {
    this.consumerKey = process.env.MPESA_CONSUMER_KEY || '';
    this.consumerSecret = process.env.MPESA_CONSUMER_SECRET || '';
    this.shortCode = process.env.MPESA_SHORTCODE || '';
  }

  async stkPush(phone: string, amount: number): Promise<{ checkout_request_id: string; response_code: string }> {
    // M-Pesa STK Push would be initiated here
    return { checkout_request_id: uuidv4(), response_code: '0' };
  }

  async processCallback(data: any): Promise<void> {
    console.log('M-Pesa callback:', data);
  }
}

// Kenya Tax (KRA)
function calculateKenyaTax(monthlyIncomeCents: number): { tax: number; paye: number; net: number } {
  const income = monthlyIncomeCents / 100;
  let tax = 0;
  
  // KRA tax bands
  if (income > 32333) tax += (Math.min(income, 50000) - 32333) * 0.1;
  if (income > 50000) tax += (Math.min(income, 80000) - 50000) * 0.15;
  if (income > 80000) tax += (Math.min(income, 180000) - 80000) * 0.2;
  if (income > 180000) tax += (Math.min(income, 300000) - 180000) * 0.25;
  if (income > 300000) tax += (income - 300000) * 0.3;
  
  return { tax: Math.round(tax * 100), paye: Math.round(tax * 100), net: monthlyIncomeCents - Math.round(tax * 100) };
}

// NSSF, NHIF
const KENYA_BENEFITS = {
  nssf: { rate: 0.06, max: 2160 }, // 6% up to KSh 2,160
  nhif: { rates: [[0, 500], [500, 600], [600, 800], [800, 1100], [1100, 1500], [1500, 2000], [2000, 2500], [2500, 3000], [3000, 3500], [3500, 4000], [4000, 5000], [5000, 6000], [6000, 7000], [7000, 8000], [8000, 9000], [9000, 10000], [10000, 12000], [12000, 14000], [14000, 16000], [16000, 20000], [20000, 25000], [25000, 30000], [30000, 35000], [35000, 40000], [40000, 50000], [50000, 60000], [60000, 1000000]] as [number, number][] },
};

function calculateNHIF(grossCents: number): number {
  const gross = grossCents / 100;
  // NHIF rates
  const rates = [[0, 5000], [5000, 6000], [6000, 7000], [7000, 8000], [8000, 9000], [9000, 10000], [10000, 11000], [11000, 12000], [12000, 13000], [13000, 14000], [14000, 15000], [15000, 16000], [16000, 17000], [17000, 18000], [18000, 19000], [19000, 20000], [20000, 25000], [25000, 30000], [30000, 35000], [35000, 40000], [40000, 45000], [45000, 50000], [50000, 1000000]];
  const contributions = [150, 200, 250, 300, 350, 400, 450, 500, 550, 600, 650, 700, 750, 800, 850, 900, 950, 1000, 1100, 1200, 1300, 1400, 1500, 1600, 1700, 1800];
  
  for (let i = 0; i < rates.length; i++) {
    if (gross <= rates[i][1]) return contributions[i] * 100;
  }
  return 1700 * 100;
}

const KENYA_EMERGENCY = { police: '999', fire: '998', ambulance: '999', tourism: '+254-20-224-2000' };
const KENYA_COUNTIES = ['Nairobi', 'Mombasa', 'Kisumu', 'Nakuru', 'Eldoret', 'Malindi', 'Kitale', 'Garissa'];

app.get('/api/currency/format', (req, res) => res.json({ success: true, data: { currency: KENYA_CURRENCY, formatted: formatKenyaShilling(parseInt(req.query.amount as string)) } }));
app.post('/api/payments/mpesa', async (req, res) => { const mpesa = new MPesaIntegration(); const result = await mpesa.stkPush(req.body.phone, req.body.amount); res.json({ success: true, data: result }); });
app.post('/api/payroll/calculate', (req, res) => { const income = req.body.monthly_income; const tax = calculateKenyaTax(income); const nhif = calculateNHIF(income); res.json({ success: true, data: { ...tax, nhif } } }); });
app.get('/api/emergency', (req, res) => res.json({ success: true, data: KENYA_EMERGENCY }));
app.get('/api/counties', (req, res) => res.json({ success: true, data: KENYA_COUNTIES }));
app.get('/health', (req, res) => res.json({ status: 'healthy', service: 'kenya-expansion' }));

const PORT = process.env.PORT || 3101;
app.listen(PORT, () => console.log(`Kenya Expansion Service on port ${PORT}`));

export default app;