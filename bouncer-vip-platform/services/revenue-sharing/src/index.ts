import express from "express";
const app = express();
app.use(express.json());
app.get("/api/royalty", (r, s) => s.json({ royalty: 5000 }));
app.get("/api/reports", (r, s) => s.json({ reports: [] }));
app.get("/health", (r, s) => s.json({ status: "healthy" }));
const PORT = 5504;
app.listen(PORT, () => console.log("RevenueSharing on " + PORT));
export default app;