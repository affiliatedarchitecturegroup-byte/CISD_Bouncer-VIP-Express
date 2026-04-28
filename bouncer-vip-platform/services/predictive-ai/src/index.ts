import express from "express";
const app = express();
app.use(express.json());
app.get("/api/predict/demand", (r, s) => s.json({ expected: 500, confidence: 0.9 }));
app.get("/api/predict/revenue", (r, s) => s.json({ predicted: 55000, range: [50000, 60000] }));
app.get("/health", (r, s) => s.json({ status: "healthy" }));
const PORT = 6300;
app.listen(PORT, () => console.log("PredictiveAI on " + PORT));
export default app;