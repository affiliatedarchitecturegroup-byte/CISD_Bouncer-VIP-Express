import express from "express";
const app = express();
app.use(express.json());
app.get("/api/dashboard/metrics", (r, s) => s.json({ revenue: 50000, guests: 500 }));
app.get("/api/incidents", (r, s) => s.json({ data: [] }));
app.get("/health", (r, s) => s.json({ status: "healthy" }));
const PORT = 6002;
app.listen(PORT, () => console.log("ManagerDashboard on " + PORT));
export default app;