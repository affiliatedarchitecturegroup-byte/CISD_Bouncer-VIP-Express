import express from "express";
const app = express();
app.use(express.json());
app.get("/api/lb/status", (r, s) => s.json({ healthy: true, backends: 3 }));
app.get("/health", (r, s) => s.json({ status: "healthy" }));
const PORT = 6500;
app.listen(PORT, () => console.log("LoadBalancer on " + PORT));
export default app;