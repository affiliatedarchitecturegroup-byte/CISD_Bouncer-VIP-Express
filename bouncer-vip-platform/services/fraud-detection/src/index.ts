import express from "express";
const app = express();
app.use(express.json());
app.post("/api/fraud/check", (r, s) => s.json({ risk_score: 0.1, status: "safe" }));
app.post("/api/id/verify", (r, s) => s.json({ valid: true }));
app.get("/health", (r, s) => s.json({ status: "healthy" }));
const PORT = 6305;
app.listen(PORT, () => console.log("FraudDetection on " + PORT));
export default app;