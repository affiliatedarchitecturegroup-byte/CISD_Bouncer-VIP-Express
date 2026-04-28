import express from 'express';
const app = express();
app.use(express.json());

// Rate limiting
async function checkRateLimit(ip) { return true; }

// Circuit breaker
const circuits = {};
function getCircuit(name) { return circuits[name] || 'closed'; }

app.get('/api/ratelimit/:ip', async (req, res) => res.json({ allowed: await checkRateLimit(req.params.ip) }));
app.get('/api/circuit/:service', (req, res) => res.json({ status: getCircuit(req.params.service) }));
app.get('/health', (req, res) => res.json({ status: 'healthy' }));
const PORT = 3500;
app.listen(PORT, () => console.log(`API Gateway on ${PORT}`));
export default app;
