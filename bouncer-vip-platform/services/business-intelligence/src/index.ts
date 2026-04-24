import express from "express";
const app = express();
app.use(express.json());
app.get("/api/dashboard", (r, s) => s.json({ revenue: 50000, guests: 500 }));
app.get("/api/kpi", (r, s) => s.json({ conversion: 0.15 }));
app.get("/health", (r, s) => s.json({ status: "healthy" }));
const PORT = 5800;
app.listen(PORT, () => console.log("BusinessIntelligence on " + PORT));
export default app;