import express from "express";
const app = express();
app.use(express.json());
app.get("/api/sla", (r, s) => s.json({ uptime: 0.999 }));
app.get("/api/apm", (r, s) => s.json({ services: 25, errors: 2 }));
app.get("/health", (r, s) => s.json({ status: "healthy" }));
const PORT = 3603;
app.listen(PORT, () => console.log("Perf on " + PORT));
export default app;