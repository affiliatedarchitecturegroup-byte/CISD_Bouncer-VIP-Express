// ===========================================
// Nigeria Expansion Service
// Local compliance, payment, features
// ===========================================

import express, { Request, Response } from 'express';
import { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';

const app = express();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
app.use(express.json());

// ===========================================
// Nigeria-Specific Types
// ===========================================

type NigerianState = 
  | 'lagos' | 'abuja' | 'kano' | 'rivers' | 'delta' | 'edo' 
  | 'ogun' | 'oyo' | 'akwa_ibom' | 'enugu';

interface NigerianCompliance {
  nin?: string; // National ID
  bvn?: string; // Bank Verification
  tin?: string; // Tax ID
  cac?: string; // Corporate Affairs Commission
}

interface NairaPayment {
  amount: number; // In kobo (1/100 Naira)
  method: 'bank_transfer' | 'ussd' | 'mobile_money' | 'card';
  bank_code?: string;
  account_number?: string;
}

// ===========================================
// Naira Currency Handling
// ===========================================

const NIGERIAN_CURRENCY = {
  code: 'NGN',
  symbol: '₦',
  name: 'Nigerian Naira',
  subunits: 100, // kobo
};

function formatNaira(kobo: number): string {
  const naira = kobo / 100;
  return `₦${naira.toLocaleString('en-NG', { minimumFractionDigits: 2 })}`;
}

function parseNairaInput(input: string): number {
  // Convert input string to kobo
  const cleaned = input.replace(/[₦,\s]/g, '');
  return Math.round(parseFloat(cleaned) * 100);
}

// ===========================================
// Nigerian Payment Gateways
// ===========================================

class PaystackIntegration {
  private secretKey: string;
  
  constructor() {
    this.secretKey = process.env.PAYSTACK_SECRET_KEY || '';
  }
  
  async initializeTransaction(email: string, amount: number): Promise<{
    authorization_url: string;
    reference: string;
  }> {
    // Paystack API call would go here
    return {
      authorization_url: `https://checkout.paystack.co/${uuidv4()}`,
      reference: uuidv4(),
    };
  }
  
  async verifyTransaction(reference: string): Promise<boolean> {
    return true;
  }
}

class FlutterwaveIntegration {
  private secretKey: string;
  
  constructor() {
    this.secretKey = process.env.FLUTTERWAVE_SECRET_KEY || '';
  }
  
  async createPayment(email: string, amount: number): Promise<{
    link: string;
    tx_ref: string;
  }> {
    return {
      link: `https://checkout.flutterwave.com/${uuidv4()}`,
      tx_ref: uuidv4(),
    };
  }
}

class USSDService {
  private banks = [
    { code: '058', name: 'Guaranty Trust Bank', ussd: '*737#' },
    { code: '076', name: 'United Bank for Africa', ussd: '*919#' },
    { code: '057', name: 'Zenith Bank', ussd: '*966#' },
    { code: '059', name: 'First Bank of Nigeria', ussd: '*894#' },
  ];
  
  async initiateUSSD(bankCode: string, amount: number, phone: string): Promise<string> {
    const bank = this.banks.find(b => b.code === bankCode);
    return `Dial ${bank?.ussd || '*737#'} to pay ₦${(amount / 100).toLocaleString()}`;
  }
}

// ===========================================
// Nigerian Compliance
// ===========================================

const NIGERIAN_COMPLIANCE = {
  // Labour laws
  minimumWage: 30000, // ₦30,000 minimum wage
  pensionRate: 0.08, // 8% pension contribution
  taxBrackets: [
    { min: 0, max: 300000, rate: 0 },
    { min: 300000, max: 600000, rate: 0.11 },
    { min: 600000, max: 1100000, rate: 0.15 },
    { min: 1100000, max: 1600000, rate: 0.19 },
    { min: 1600000, max: 3200000, rate: 0.21 },
    { min: 3200000, max: Infinity, rate: 0.24 },
  ],
  
  // Required documents
  requiredDocuments: [
    'valid_id',
    'bvn',
    'passport_photo',
    'proof_of_address',
  ],
  
  // Reporting requirements
  reporting: {
    nhf: true, // National Housing Fund
    nhfRate: 0.025,
    nsitf: true, // Industrial Training Fund
    nsitfRate: 0.01,
  },
};

function calculateNigerianTax(monthlyIncomeKobo: number): {
  taxableIncome: number;
  tax: number;
  pension: number;
  nhf: number;
  nsitf: number;
  netPay: number;
} {
  const monthlyIncome = monthlyIncomeKobo / 100;
  
  // Find tax bracket
  let tax = 0;
  for (const bracket of NIGERIAN_COMPLIANCE.taxBrackets) {
    if (monthlyIncome > bracket.min && monthlyIncome <= bracket.max) {
      tax = (monthlyIncome - bracket.min) * bracket.rate;
      break;
    }
  }
  
  const pension = monthlyIncome * NIGERIAN_COMPLIANCE.pensionRate;
  const nhf = monthlyIncome * NIGERIAN_COMPLIANCE.reporting.nhfRate;
  const nsitf = monthlyIncome * NIGERIAN_COMPLIANCE.reporting.nsitfRate;
  
  return {
    taxableIncome: monthlyIncomeKobo,
    tax: Math.round(tax * 100),
    pension: Math.round(pension * 100),
    nhf: Math.round(nhf * 100),
    nsitf: Math.round(nsitf * 100),
    netPay: monthlyIncomeKobo - Math.round(tax * 100) - Math.round(pension * 100) - Math.round(nhf * 100) - Math.round(nsitf * 100),
  };
}

// ===========================================
// Local Features
// ===========================================

// Local emergency contacts
const NIGERIA_EMERGENCY_CONTACTS = {
  police: '911',
  fire: '112',
  ambulance: '112',
  efcc: '0803-234-5678`, // Economic crimes
  nscdc: '0806-298-5000`, // Civil defence
};

// Local bank codes
const NIGERIA_BANK_CODES = {
  '058': 'Guaranty Trust Bank',
  '076': 'United Bank for Africa',
  '057': 'Zenith Bank',
  '059': 'First Bank of Nigeria',
  '050': 'Ecobank',
  '084': 'Enterprise Bank',
  '063': 'Diamond Bank',
  '082': 'Sterling Bank',
  '089': 'Keystone Bank',
  '011': 'First City Monument Bank',
};

// ===========================================
// API Routes
// ===========================================

app.get('/api/currency/format', (req: Request, res: Response) => {
  const { amount } = req.query;
  res.json({ 
    success: true, 
    data: { 
      currency: NIGERIAN_CURRENCY,
      formatted: formatNaira(parseInt(amount as string)) 
    } 
  });
});

app.post('/api/payments/paystack', async (req: Request, res: Response) => {
  const { email, amount } = req.body;
  const paystack = new PaystackIntegration();
  const result = await paystack.initializeTransaction(email, amount);
  res.json({ success: true, data: result });
});

app.post('/api/payments/flutterwave', async (req: Request, res: Response) => {
  const { email, amount } = req.body;
  const flutterwave = new FlutterwaveIntegration();
  const result = await flutterwave.createPayment(email, amount);
  res.json({ success: true, data: result });
});

app.post('/api/payments/ussd', async (req: Request, res: Response) => {
  const { bank_code, amount, phone } = req.body;
  const ussd = new USSDService();
  const instruction = await ussd.initiateUSSD(bank_code, amount, phone);
  res.json({ success: true, data: { instruction } });
});

app.post('/api/payroll/calculate', (req: Request, res: Response) => {
  const { monthly_income } = req.body;
  const calculation = calculateNigerianTax(monthly_income);
  res.json({ success: true, data: calculation });
});

app.get('/api/banks', (req: Request, res: Response) => {
  res.json({ success: true, data: NIGERIA_BANK_CODES });
});

app.get('/api/emergency', (req: Request, res: Response) => {
  res.json({ success: true, data: NIGERIA_EMERGENCY_CONTACTS });
});

app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'healthy', service: 'nigeria-expansion' });
});

const PORT = process.env.PORT || 3100;
app.listen(PORT, () => console.log(`Nigeria Expansion Service on port ${PORT}`));

export default app;