import express from "express";
const app = express();
app.use(express.json());
app.get("/api/schedule/staff", (r, s) => s.json({ recommended: 15 }));
app.post("/api/schedule/optimize", (r, s) => s.json({ shifts: [] }));
app.get("/health", (r, s) => s.json({ status: "healthy" }));
const PORT = 6304;
app.listen(PORT, () => console.log("SmartScheduling on " + PORT));
export default app;