import express from "express";
const app = express();
app.use(express.json());
app.get("/api/milestones", (r, s) => s.json({ next: 10, reward: "free bottle" }));
app.post("/api/milestone/claim", (r, s) => s.json({ claimed: true }));
app.get("/health", (r, s) => s.json({ status: "healthy" }));
const PORT = 5704;
app.listen(PORT, () => console.log("MilestoneRewards on " + PORT));
export default app;