import express from "express";
const app = express();
app.use(express.json());
const kpis = [{ id: "revenue", target: 100000 }];
app.get("/api/kpis", (r, s) => s.json({ success: true, data: kpis }));
app.get("/health", (r, s) => s.json({ status: "healthy" }));
const PORT = 3601;
app.listen(PORT, () => console.log("Metrics on " + PORT));
export default app;