import express from "express";
const app = express();
app.use(express.json());
app.get("/api/iac", (r, s) => s.json({ templates: [] }));
app.get("/api/orchestration", (r, s) => s.json({ pods: 10, services: 50 }));
app.get("/health", (r, s) => s.json({ status: "healthy" }));
const PORT = 4005;
app.listen(PORT, () => console.log("DevOps on " + PORT));
export default app;