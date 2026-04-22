// ===========================================
// Payment Gateway Service
// Multi-provider payment processing (Stripe, PayPal, EFT)
// ===========================================

import express, { Request, Response } from 'express';
import { Pool } from 'pg';
import Redis from 'ioredis';
import { v4 as uuidv4 } from 'uuid';
import Stripe from 'stripe';
import axios from 'axios';

const app = express();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const redis = new Redis(process.env.REDIS_URL);

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', { apiVersion: '2023-10-16' });

app.use(express.json());

// ===========================================
// Types
// ===========================================

type PaymentMethod = 'card' | 'eft' | 'cash' | 'crypto';
type PaymentStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'refunded';
type Provider = 'stripe' | 'paypal' | 'eft';

interface Payment {
  id: string;
  invoice_id: string;
  amount: number;
  currency: string;
  method: PaymentMethod;
  provider: Provider;
  status: PaymentStatus;
  provider_reference?: string;
  metadata?: Record<string, string>;
  created_at: string;
}

interface Refund {
  id: string;
  payment_id: string;
  amount: number;
  reason: string;
  status: 'pending' | 'completed' | 'failed';
  processed_at?: string;
}

// ===========================================
// Stripe Integration
// ===========================================

async function createStripePayment(data: {
  amount: number;
  currency: string;
  invoice_id: string;
  customer_id?: string;
  description?: string;
}): Promise<{ clientSecret: string; paymentIntentId: string }> {
  const paymentIntent = await stripe.paymentIntents.create({
    amount: Math.round(data.amount * 100), // Convert to cents
    currency: data.currency.toLowerCase(),
    metadata: {
      invoice_id: data.invoice_id,
      ...data.metadata,
    },
    description: data.description,
    ...(data.customer_id && { customer: data.customer_id }),
  });
  
  // Store in database
  await pool.query(`
    INSERT INTO payments (id, invoice_id, amount, currency, method, provider, status, provider_reference)
    VALUES ($1, $2, $3, $4, 'card', 'stripe', 'processing', $5)
  `, [uuidv4(), data.invoice_id, data.amount, data.currency, paymentIntent.id]);
  
  return {
    clientSecret: paymentIntent.client_secret!,
    paymentIntentId: paymentIntent.id,
  };
}

async function confirmStripePayment(paymentIntentId: string): Promise<PaymentStatus> {
  try {
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
    
    let status: PaymentStatus = 'processing';
    if (paymentIntent.status === 'succeeded') status = 'completed';
    else if (paymentIntent.status === 'canceled') status = 'failed';
    
    await pool.query(`
      UPDATE payments SET status = $1, updated_at = NOW() WHERE provider_reference = $2
    `, [status, paymentIntentId]);
    
    return status;
  } catch (error) {
    return 'failed';
  }
}

async function processStripeWebhook(payload: any, signature: string): Promise<void> {
  try {
    const event = stripe.webhooks.constructEvent(
      payload,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET || ''
    );
    
    switch (event.type) {
      case 'payment_intent.succeeded': {
        const intent = event.data.object as any;
        await pool.query(`
          UPDATE payments SET status = 'completed', updated_at = NOW()
          WHERE provider_reference = $1
        `, [intent.id]);
        
        // Update invoice status
        const payment = await pool.query(
          'SELECT invoice_id FROM payments WHERE provider_reference = $1',
          [intent.id]
        );
        if (payment.rows[0]) {
          await pool.query(`
            UPDATE invoices SET status = 'paid', paid_at = NOW(), updated_at = NOW()
            WHERE id = $1
          `, [payment.rows[0].invoice_id]);
        }
        break;
      }
      case 'payment_intent.payment_failed': {
        const intent = event.data.object as any;
        await pool.query(`
          UPDATE payments SET status = 'failed', updated_at = NOW()
          WHERE provider_reference = $1
        `, [intent.id]);
        break;
      }
    }
  } catch (error) {
    console.error('Webhook error:', error);
  }
}

// ===========================================
// PayPal Integration
// ===========================================

async function createPayPalOrder(data: {
  amount: number;
  currency: string;
  invoice_id: string;
  return_url: string;
  cancel_url: string;
}): Promise<{ approvalUrl: string; orderId: string }> {
  const response = await axios.post(`${process.env.PAYPAL_API_URL}/v2/checkout/orders`, {
    intent: 'CAPTURE',
    purchase_units: [{
      amount: {
        currency_code: data.currency,
        value: data.amount.toFixed(2),
      },
      reference_id: data.invoice_id,
    }],
  }, {
    headers: {
      'Authorization': `Bearer ${await getPayPalAccessToken()}`,
      'Content-Type': 'application/json',
    },
  });
  
  const orderId = response.data.id;
  
  await pool.query(`
    INSERT INTO payments (id, invoice_id, amount, currency, method, provider, status, provider_reference)
    VALUES ($1, $2, $3, $4, 'card', 'paypal', 'processing', $5)
  `, [uuidv4(), data.invoice_id, data.amount, data.currency, orderId]);
  
  const approvalUrl = response.data.links.find((l: any) => l.rel === 'approve').href;
  
  return { approvalUrl, orderId };
}

async function capturePayPalOrder(orderId: string): Promise<PaymentStatus> {
  try {
    await axios.post(`${process.env.PAYPAL_API_URL}/v2/checkout/orders/${orderId}/capture`, {}, {
      headers: {
        'Authorization': `Bearer ${await getPayPalAccessToken()}`,
        'Content-Type': 'application/json',
      },
    });
    
    await pool.query(`
      UPDATE payments SET status = 'completed', updated_at = NOW()
      WHERE provider_reference = $1
    `, [orderId]);
    
    return 'completed';
  } catch (error) {
    await pool.query(`
      UPDATE payments SET status = 'failed', updated_at = NOW()
      WHERE provider_reference = $1
    `, [orderId]);
    return 'failed';
  }
}

// ===========================================
// EFT Processing
// ===========================================

async function initiateEFTPayment(data: {
  invoice_id: string;
  amount: number;
  bank_name: string;
  account_number: string;
  account_type: 'savings' | 'current';
  branch_code: string;
  reference: string;
}): Promise<{ eft_reference: string; status: string }> {
  const eftReference = `EFT-${Date.now()}-${uuidv4().slice(0, 8)}`;
  
  // In production, integrate with PayShap or Bankserv
  await pool.query(`
    INSERT INTO payments (id, invoice_id, amount, currency, method, provider, status)
    VALUES ($1, $2, $3, 'ZAR', 'eft', 'eft', 'processing')
  `, [uuidv4(), data.invoice_id, data.amount]);
  
  // Queue for processing (typically takes 1-2 business days)
  await redis.lpush('eft:pending', JSON.stringify({
    reference: eftReference,
    bank_name: data.bank_name,
    account_number: data.account_number,
    account_type: data.account_type,
    branch_code: data.branch_code,
    amount: data.amount,
    invoice_id: data.invoice_id,
  }));
  
  return { eft_reference: eftReference, status: 'processing' };
}

async function processEFTQueue(): Promise<void> {
  while (true) {
    const item = await redis.rpop('eft:pending');
    if (!item) break;
    
    const payment = JSON.parse(item);
    
    // Simulate EFT processing
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Update payment status
    await pool.query(`
      UPDATE payments SET status = 'completed', updated_at = NOW()
      WHERE invoice_id = $1
    `, [payment.invoice_id]);
    
    // Update invoice
    await pool.query(`
      UPDATE invoices SET status = 'paid', paid_at = NOW(), updated_at = NOW()
      WHERE id = $1
    `, [payment.invoice_id]);
  }
}

// ===========================================
// Refunds
// ===========================================

async function createRefund(data: {
  payment_id: string;
  amount: number;
  reason: string;
}): Promise<Refund> {
  const id = uuidv4();
  
  const payment = await pool.query(
    'SELECT * FROM payments WHERE id = $1',
    [data.payment_id]
  );
  
  if (!payment.rows[0]) throw new Error('Payment not found');
  if (payment.rows[0].status !== 'completed') throw new Error('Payment not completed');
  
  await pool.query(`
    INSERT INTO refunds (id, payment_id, amount, reason, status)
    VALUES ($1, $2, $3, $4, 'pending')
  `, [id, data.payment_id, data.amount, data.reason]);
  
  // Process refund based on provider
  if (payment.rows[0].provider === 'stripe') {
    await stripe.refunds.create({
      payment_intent: payment.rows[0].provider_reference,
      amount: Math.round(data.amount * 100),
    });
  }
  
  await pool.query(`
    UPDATE refunds SET status = 'completed', processed_at = NOW() WHERE id = $1
  `, [id]);
  
  return { id, payment_id: data.payment_id, amount: data.amount, reason: data.reason, status: 'completed' };
}

// ===========================================
// Payment Methods
// ===========================================

async function getPaymentMethods(): Promise<{ method: PaymentMethod; provider: Provider; enabled: boolean }[]> {
  return [
    { method: 'card', provider: 'stripe', enabled: true },
    { method: 'card', provider: 'paypal', enabled: true },
    { method: 'eft', provider: 'eft', enabled: true },
  ];
}

// ===========================================
// Analytics
// ===========================================

async function getPaymentAnalytics(dateRange?: { start: string; end: string }): Promise<{
  total_transactions: number;
  total_amount: number;
  success_rate: number;
  average_amount: number;
  by_method: Record<string, number>;
  by_provider: Record<string, number>;
}> {
  let query = 'SELECT * FROM payments WHERE 1=1';
  const params: any[] = [];
  
  if (dateRange) {
    params.push(dateRange.start, dateRange.end);
    query += ` AND created_at BETWEEN $1 AND $2`;
  }
  
  const payments = await pool.query(query, params);
  
  const totalAmount = payments.rows.reduce((sum, p) => sum + p.amount, 0);
  const successful = payments.rows.filter(p => p.status === 'completed').length;
  
  return {
    total_transactions: payments.rows.length,
    total_amount: totalAmount,
    success_rate: Math.round((successful / payments.rows.length) * 100),
    average_amount: payments.rows.length > 0 ? totalAmount / payments.rows.length : 0,
    by_method: payments.rows.reduce((acc, p) => ({ ...acc, [p.method]: (acc[p.method] || 0) + 1 }), {}),
    by_provider: payments.rows.reduce((acc, p) => ({ ...acc, [p.provider]: (acc[p.provider] || 0) + 1 }), {}),
  };
}

// ===========================================
// API Routes
// ===========================================

// Stripe
app.post('/api/payments/stripe/create', async (req: Request, res: Response) => {
  try {
    const result = await createStripePayment(req.body);
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to create payment' });
  }
});

app.post('/api/payments/stripe/confirm/:id', async (req: Request, res: Response) => {
  try {
    const status = await confirmStripePayment(req.params.id);
    res.json({ success: true, data: { status } });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to confirm payment' });
  }
});

app.post('/api/webhooks/stripe', express.raw({ type: 'application/json' }), async (req: Request, res: Response) => {
  try {
    const signature = req.headers['stripe-signature'] as string;
    await processStripeWebhook(req.body, signature);
    res.json({ received: true });
  } catch (error) {
    res.status(400).json({ error: 'Webhook error' });
  }
});

// PayPal
app.post('/api/payments/paypal/create', async (req: Request, res: Response) => {
  try {
    const result = await createPayPalOrder(req.body);
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to create order' });
  }
});

app.post('/api/payments/paypal/capture/:id', async (req: Request, res: Response) => {
  try {
    const status = await capturePayPalOrder(req.params.id);
    res.json({ success: true, data: { status } });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to capture order' });
  }
});

// EFT
app.post('/api/payments/eft', async (req: Request, res: Response) => {
  try {
    const result = await initiateEFTPayment(req.body);
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to initiate EFT' });
  }
});

// Refunds
app.post('/api/refunds', async (req: Request, res: Response) => {
  try {
    const refund = await createRefund(req.body);
    res.status(201).json({ success: true, data: refund });
  } catch (error) {
    res.status(400).json({ success: false, error: (error as Error).message });
  }
});

// Methods
app.get('/api/methods', async (req: Request, res: Response) => {
  try {
    const methods = await getPaymentMethods();
    res.json({ success: true, data: methods });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch methods' });
  }
});

// Analytics
app.get('/api/analytics', async (req: Request, res: Response) => {
  try {
    const { start, end } = req.query as any;
    const analytics = await getPaymentAnalytics({ start, end });
    res.json({ success: true, data: analytics });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch analytics' });
  }
});

// Health
app.get('/health', async (req: Request, res: Response) => {
  res.json({ status: 'healthy', service: 'payment-gateway' });
});

// ===========================================
// Helpers
// ===========================================

async function getPayPalAccessToken(): Promise<string> {
  const cacheKey = 'paypal:access_token';
  const cached = await redis.get(cacheKey);
  if (cached) return cached;
  
  const response = await axios.post(`${process.env.PAYPAL_API_URL}/v1/oauth2/token`,
    new URLSearchParams({ grant_type: 'client_credentials' }),
    {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      auth: {
        username: process.env.PAYPAL_CLIENT_ID || '',
        password: process.env.PAYPAL_SECRET || '',
      },
    }
  );
  
  await redis.setex(cacheKey, 3500, response.data.access_token);
  return response.data.access_token;
}

const PORT = process.env.PORT || 3021;

app.listen(PORT, () => console.log(`Payment Gateway Service on port ${PORT}`));

export default app;