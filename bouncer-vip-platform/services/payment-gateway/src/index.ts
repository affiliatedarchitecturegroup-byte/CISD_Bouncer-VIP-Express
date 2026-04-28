import express from 'express';
const app = express();
app.use(express.json());

const gateways = ['stripe', 'paypal', 'flutterwave', 'mpesa'];

app.get('/api/gateways', (req, res) => res.json({ success: true, data: gateways }));
app.get('/health', (req, res) => res.json({ status: 'healthy' }));
const PORT = 3403;
app.listen(PORT, () => console.log(`Payment Gateway on ${PORT}`));
export default app;
