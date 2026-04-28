import express from "express";
const app = express();
app.use(express.json());
app.post("/api/mining", (r, s) => s.json({ processes: [], insights: [] }));
app.post("/api/optimize", (r, s) => s.json({ optimized: true }));
app.get("/health", (r, s) => s.json({ status: "healthy" }));
const PORT = 4903;
app.listen(PORT, () => console.log("ProcessAuto on " + PORT));
export default app;