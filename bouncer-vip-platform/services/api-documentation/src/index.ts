import express from 'express';
const app = express();
app.use(express.json());

const openapi = { openapi: '3.0.0', info: { title: 'Bouncer API', version: '1.0.0' }, paths: {} };

app.get('/api/openapi', (req, res) => res.json({ success: true, data: openapi }));
app.get('/api/docs', (req, res) => res.redirect('/ docs'));
app.get('/health', (req, res) => res.json({ status: 'healthy' }));
const PORT = 3505;
app.listen(PORT, () => console.log(`API Docs on ${PORT}`));
export default app;
