import express from "express";
const app = express();
app.use(express.json());
app.get("/api/resources", (r, s) => s.json({ cpu: 100, memory: 512 }));
app.post("/api/orchestrate", (r, s) => s.json({ orchestrated: true }));
app.get("/health", (r, s) => s.json({ status: "healthy" }));
const PORT = 5005;
app.listen(PORT, () => console.log("PlatformOS on " + PORT));
export default app;