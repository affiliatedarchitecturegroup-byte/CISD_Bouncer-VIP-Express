import express from 'express';
const app = express();
app.use(express.json());

async function sendWebhook(url, payload) { return { sent: true }; }

app.post('/api/outgoing', async (req, res) => res.json({ success: true, data: await sendWebhook(req.body.url, req.body.payload) }));
app.post('/api/incoming', (req, res) => res.json({ received: true }));
app.get('/health', (req, res) => res.json({ status: 'healthy' }));
const PORT = 3501;
app.listen(PORT, () => console.log(`Webhook Integration on ${PORT}`));
export default app;
