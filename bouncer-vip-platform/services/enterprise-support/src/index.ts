import express from "express";
const app = express();
app.use(express.json());
app.get("/api/support/tiers", (r, s) => s.json({ data: ["basic", "premium", "enterprise"] }));
app.post("/api/ticket", (r, s) => s.json({ ticket_id: "t1", priority: "high" }));
app.get("/health", (r, s) => s.json({ status: "healthy" }));
const PORT = 4105;
app.listen(PORT, () => console.log("EntSupport on " + PORT));
export default app;