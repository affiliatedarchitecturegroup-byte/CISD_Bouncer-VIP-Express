import express from "express";
const app = express();
app.use(express.json());
app.get("/api/follow-bonus", (r, s) => s.json({ bonus: 100 }));
app.post("/api/checkin/reward", (r, s) => s.json({ rewarded: true }));
app.get("/health", (r, s) => s.json({ status: "healthy" }));
const PORT = 5705;
app.listen(PORT, () => console.log("SocialRewards on " + PORT));
export default app;