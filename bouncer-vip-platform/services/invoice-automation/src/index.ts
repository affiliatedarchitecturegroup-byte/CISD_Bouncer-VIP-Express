import express from 'express';
import { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';
const app = express();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
app.use(express.json());

async function generateInvoice(data) {
  const id = uuidv4();
  await pool.query(`INSERT INTO invoices (id, client_id, amount, status, created_at) VALUES ($1, $2, $3, 'pending', NOW())`, [id, data.client_id, data.amount]);
  return { id, ...data };
}

app.post('/api/invoices', async (req, res) => res.json({ success: true, data: await generateInvoice(req.body) }));
app.get('/health', (req, res) => res.json({ status: 'healthy' }));
const PORT = 3404;
app.listen(PORT, () => console.log(`Invoice Automation on ${PORT}`));
export default app;
