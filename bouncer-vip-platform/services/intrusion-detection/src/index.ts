import express from "express";
const app = express();
app.use(express.json());
app.get("/api/waf/status", (r, s) => s.json({ active: true, blocked: 5 }));
app.get("/api/threats", (r, s) => s.json({ threats: [] }));
app.get("/health", (r, s) => s.json({ status: "healthy" }));
const PORT = 6404;
app.listen(PORT, () => console.log("IntrusionDetection on " + PORT));
export default app;