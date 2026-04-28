import express from "express";
const app = express();
app.use(express.json());
app.get("/api/metrics", (r, s) => s.json({ cpu: 0.5, memory: 0.6, requests: 1000 }));
app.get("/api/logs", (r, s) => s.json({ logs: [] }));
app.get("/health", (r, s) => s.json({ status: "healthy" }));
const PORT = 6504;
app.listen(PORT, () => console.log("Monitoring on " + PORT));
export default app;