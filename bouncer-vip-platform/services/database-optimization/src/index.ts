import express from "express";
const app = express();
app.use(express.json());
app.get("/api/db/stats", (r, s) => s.json({ connections: 50, queries_per_sec: 1000 }));
app.get("/health", (r, s) => s.json({ status: "healthy" }));
const PORT = 6502;
app.listen(PORT, () => console.log("DBOptimization on " + PORT));
export default app;