import express from 'express';
const app = express();
app.use(express.json());

const connectors = ['salesforce', 'quickbooks', 'sage', 'workday'];

app.get('/api/connectors', (req, res) => res.json({ success: true, data: connectors }));
app.get('/health', (req, res) => res.json({ status: 'healthy' }));
const PORT = 3504;
app.listen(PORT, () => console.log(`Integration Hub on ${PORT}`));
export default app;
