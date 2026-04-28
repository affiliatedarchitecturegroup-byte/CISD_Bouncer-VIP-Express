import express from 'express';
import { Pool } from 'pg';
const app = express();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
app.use(express.json());

async function exportCSV(table) { return 'id,name\n1,test'; }
async function exportJSON(table) { return [{ id: 1, name: 'test' }]; }

app.get('/api/export/csv/:table', async (req, res) => res.json({ data: await exportCSV(req.params.table) }));
app.get('/api/export/json/:table', async (req, res) => res.json({ data: await exportJSON(req.params.table) }));
app.get('/health', (req, res) => res.json({ status: 'healthy' }));
const PORT = 3503;
app.listen(PORT, () => console.log(`Data Export on ${PORT}`));
export default app;
