// Advanced Payment Service
import express from 'express';
import { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';

const app = express();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
app.use(express.json());

// Payment methods
const paymentMethods = ['card', 'bank_transfer', 'mpesa', 'flutterwave', 'paystack'];

// Payment routing
async function routePayment(amount: number, currency: string, method: string): Promise<{gateway: string, rate: number}> {
  // Simple routing logic
  if (method === 'card') return { gateway: 'stripe', rate: 0.029 };
  if (method === 'mpesa') return { gateway: 'flutterwave', rate: 0.015 };
  return { gateway: 'bank', rate: 0.01 };
}

// Fraud detection
interface FraudCheck { score: number; flags: string[]; }
async function checkFraud(amount: number, userId: string, method: string): Promise<FraudCheck> {
  const flags: string[] = [];
  if (amount > 50000) flags.push('high_amount');
  // Additional checks would go here
  return { score: flags.length > 0 ? 0.8 : 0.1, flags };
}

// Process payment
async function processPayment(data: any): Promise<any> {
  const id = uuidv4();
  const { gateway, rate } = await routePayment(data.amount, data.currency, data.method);
  const fee = data.amount * rate;
  
  await pool.query(`INSERT INTO payments (id, user_id, amount, currency, method, gateway, fee, status, created_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending')`,
    [id, data.user_id, data.amount, data.currency, data.method, gateway, fee, new Date().toISOString()]);
  
  return { id, gateway, fee, net: data.amount - fee };
}

// Refund
async function refundPayment(paymentId: string, reason: string): Promise<any> {
  await pool.query(`INSERT INTO refunds (id, payment_id, reason, status, created_at)
    VALUES ($1, $2, $3, 'pending', NOW())`, [uuidv4(), paymentId, reason]);
  return { success: true };
}

app.get('/api/methods', (req, res) => res.json({ success: true, data: paymentMethods }));
app.post('/api/route', async (req, res) => { const route = await routePayment(req.body.amount, req.body.currency, req.body.method); res.json({ success: true, data: route }); });
app.post('/api/fraud/check', async (req, res) => { const check = await checkFraud(req.body.amount, req.body.user_id, req.body.method); res.json({ success: true, data: check }); });
app.post('/api/payments', async (req, res) => { const payment = await processPayment(req.body); res.json({ success: true, data: payment }); });
app.post('/api/refunds', async (req, res) => { const refund = await refundPayment(req.body.payment_id, req.body.reason); res.json({ success: true, data: refund }); });
app.get('/health', (req, res) => res.json({ status: 'healthy', service: 'payment-advanced' }));

const PORT = process.env.PORT || 3400;
app.listen(PORT, () => console.log(`Advanced Payment on port ${PORT}`));

export default app;