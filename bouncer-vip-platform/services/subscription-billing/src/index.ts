// Subscription Billing Service
import express from 'express';
import { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';

const app = express();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
app.use(express.json());

const plans = [
  { id: 'basic', name: 'Basic', price: 999, interval: 'month' },
  { id: 'pro', name: 'Pro', price: 2499, interval: 'month' },
  { id: 'enterprise', name: 'Enterprise', price: 9999, interval: 'month' },
];

async function createSubscription(userId: string, planId: string): Promise<any> {
  const id = uuidv4();
  await pool.query(`INSERT INTO subscriptions (id, user_id, plan_id, status, created_at) VALUES ($1, $2, $3, 'active', NOW())`,
    [id, userId, planId]);
  return { id, plan: plans.find(p => p.id === planId) };
}

app.get('/api/plans', (req, res) => res.json({ success: true, data: plans }));
app.post('/api/subscriptions', async (req, res) => { const sub = await createSubscription(req.body.user_id, req.body.plan_id); res.json({ success: true, data: sub }); });
app.get('/health', (req, res) => res.json({ status: 'healthy' }));

const PORT = 3401;
app.listen(PORT, () => console.log(`Subscription Billing on port ${PORT}`));
export default app;
