import express from "express";
const app = express();
app.use(express.json());
app.get("/api/revenue-by-source", (r, s) => s.json({ bottle: 30000, table: 15000, bar: 5000 }));
app.get("/api/trends", (r, s) => s.json({ trending: "up", change: 0.15 }));
app.get("/health", (r, s) => s.json({ status: "healthy" }));
const PORT = 5802;
app.listen(PORT, () => console.log("RevenueAnalytics on " + PORT));
export default app;