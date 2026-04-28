import express from "express";
const app = express();
app.use(express.json());
app.post("/api/lighting/set", (r, s) => s.json({ scene: "party", active: true }));
app.post("/api/sound/mix", (r, s) => s.json({ level: 80, eq: "flat" }));
app.get("/health", (r, s) => s.json({ status: "healthy" }));
const PORT = 6102;
app.listen(PORT, () => console.log("AVControl on " + PORT));
export default app;