import express from 'express';
const app = express();
app.use(express.json());

const integrations = ['slack', 'teams', 'salesforce', 'quickbooks'];

async function syncToSlack(data) { return { synced: true }; }

app.get('/api/integrations', (req, res) => res.json({ success: true, data: integrations }));
app.post('/api/slack', async (req, res) => res.json({ success: true, data: await syncToSlack(req.body) }));
app.get('/health', (req, res) => res.json({ status: 'healthy' }));
const PORT = 3502;
app.listen(PORT, () => console.log(`Thirdparty on ${PORT}`));
export default app;
