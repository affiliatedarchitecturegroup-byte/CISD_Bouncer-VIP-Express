import express from "express";
const app = express();
app.use(express.json());
app.get("/api/scale", (r, s) => s.json({ instances: 5, cpu: 60 }));
app.get("/api/cdn/status", (r, s) => s.json({ enabled: true }));
app.get("/health", (r, s) => s.json({ status: "healthy" }));
const PORT = 4004;
app.listen(PORT, () => console.log("Scale on " + PORT));
export default app;