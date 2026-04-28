import express from "express";
const app = express();
app.use(express.json());
app.post("/api/hvac/set", (r, s) => s.json({ temperature: 72, mode: "cool" }));
app.get("/api/occupancy", (r, s) => s.json({ count: 450 }));
app.get("/health", (r, s) => s.json({ status: "healthy" }));
const PORT = 6104;
app.listen(PORT, () => console.log("EnvironmentalCtrl on " + PORT));
export default app;