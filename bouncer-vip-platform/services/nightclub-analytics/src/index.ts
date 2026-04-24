import express from "express";
const app = express();
app.use(express.json());
app.get("/api/revenue", (r, s) => s.json({ total: 50000, tonight: 12000 }));
app.get("/api/peak-hours", (r, s) => s.json({ peak: ["22:00", "23:00", "00:00"] }));
app.get("/health", (r, s) => s.json({ status: "healthy" }));
const PORT = 5204;
app.listen(PORT, () => console.log("ClubAnalytics on " + PORT));
export default app;