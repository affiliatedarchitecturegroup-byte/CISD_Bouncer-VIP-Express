import express from "express";
const app = express();
app.use(express.json());
app.get("/api/revenue-per-guest", (r, s) => s.json({ avg: 500 }));
app.get("/api/table-turnover", (r, s) => s.json({ rate: 2.5 }));
app.get("/health", (r, s) => s.json({ status: "healthy" }));
const PORT = 5304;
app.listen(PORT, () => console.log("PremiumAnalytics on " + PORT));
export default app;