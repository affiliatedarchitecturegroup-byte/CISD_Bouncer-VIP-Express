import express from 'express';
import crypto from 'crypto';
const app = express();
app.use(express.json());

function encrypt(data, key) {
  return crypto.createHash('sha256').update(data + key).digest('hex');
}

app.post('/api/encrypt', (req, res) => res.json({ success: true, data: encrypt(req.body.data, req.body.key) }));
app.get('/health', (req, res) => res.json({ status: 'healthy' }));
const PORT = 3405;
app.listen(PORT, () => console.log(`Financial Security on ${PORT}`));
export default app;
