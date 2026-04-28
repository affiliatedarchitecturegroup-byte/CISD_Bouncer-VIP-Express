import express from "express";
const app = express();
app.use(express.json());
app.get("/api/staff-productivity", (r, s) => s.json({ per_staff: 500 }));
app.get("/api/table-turnover", (r, s) => s.json({ rate: 2.5 }));
app.get("/health", (r, s) => s.json({ status: "healthy" }));
const PORT = 5804;
app.listen(PORT, () => console.log("OperationalAnalytics on " + PORT));
export default app;