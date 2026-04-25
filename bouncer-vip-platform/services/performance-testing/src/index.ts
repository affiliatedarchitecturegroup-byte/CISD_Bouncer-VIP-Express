import express from "express";
const app = express();
app.use(express.json());
app.get("/api/benchmarks", (r, s) => s.json({ rps: 5000, latency_p95: 50 }));
app.post("/api/load-test", (r, s) => s.json({ test_id: "t1", status: "running" }));
app.get("/health", (r, s) => s.json({ status: "healthy" }));
const PORT = 6505;
app.listen(PORT, () => console.log("PerfTesting on " + PORT));
export default app;