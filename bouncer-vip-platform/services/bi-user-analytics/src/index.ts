import express from "express";
const app = express();
app.use(express.json());
app.get("/api/cohorts", (r, s) => s.json({ success: true, data: [] }));
app.get("/api/funnels", (r, s) => s.json({ success: true, data: [] }));
app.get("/health", (r, s) => s.json({ status: "healthy" }));
const PORT = 3602;
app.listen(PORT, () => console.log("BI on " + PORT));
export default app;