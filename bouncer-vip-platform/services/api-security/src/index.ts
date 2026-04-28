import express from "express";
const app = express();
app.use(express.json());
app.get("/api/rate-limit/status", (r, s) => s.json({ remaining: 950, limit: 1000 }));
app.post("/api/validate", (r, s) => s.json({ valid: true }));
app.get("/health", (r, s) => s.json({ status: "healthy" }));
const PORT = 6402;
app.listen(PORT, () => console.log("APISecurity on " + PORT));
export default app;