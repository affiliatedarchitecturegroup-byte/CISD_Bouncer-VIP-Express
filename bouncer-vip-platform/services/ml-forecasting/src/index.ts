import express from "express";
const app = express();
app.use(express.json());
app.post("/api/forecast", (r, s) => s.json({ prediction: 100, confidence: 0.95 }));
app.post("/api/anomaly", (r, s) => s.json({ anomalies: [], score: 0.1 }));
app.get("/health", (r, s) => s.json({ status: "healthy" }));
const PORT = 4900;
app.listen(PORT, () => console.log("Predictive on " + PORT));
export default app;