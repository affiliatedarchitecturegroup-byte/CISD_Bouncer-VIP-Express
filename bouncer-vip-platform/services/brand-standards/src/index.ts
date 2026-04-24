import express from "express";
const app = express();
app.use(express.json());
app.get("/api/audit", (r, s) => s.json({ score: 95 }));
app.post("/api/certification", (r, s) => s.json({ certified: true }));
app.get("/health", (r, s) => s.json({ status: "healthy" }));
const PORT = 5503;
app.listen(PORT, () => console.log("BrandStandards on " + PORT));
export default app;