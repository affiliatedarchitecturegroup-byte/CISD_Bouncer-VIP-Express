import express from "express";
const app = express();
app.use(express.json());
app.post("/api/analytics/event", (r, s) => s.json({ tracked: true }));
app.get("/api/analytics/report", (r, s) => s.json({ sessions: 5000 }));
app.get("/health", (r, s) => s.json({ status: "healthy" }));
const PORT = 6203;
app.listen(PORT, () => console.log("AnalyticsIntegration on " + PORT));
export default app;