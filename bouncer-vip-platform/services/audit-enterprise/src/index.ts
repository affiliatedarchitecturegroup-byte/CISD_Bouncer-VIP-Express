import express from "express";
const app = express();
app.use(express.json());
app.get("/api/reports/soc2", (r, s) => s.json({ compliant: true }));
app.get("/api/retention", (r, s) => s.json({ period: 7 }));
app.get("/health", (r, s) => s.json({ status: "healthy" }));
const PORT = 4103;
app.listen(PORT, () => console.log("AuditEnt on " + PORT));
export default app;