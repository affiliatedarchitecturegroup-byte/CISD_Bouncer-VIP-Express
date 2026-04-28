import express from "express";
const app = express();
app.use(express.json());
app.post("/api/reason", (r, s) => s.json({ reasoning: "conclusion", confidence: 0.9 }));
app.post("/api/intent", (r, s) => s.json({ intent: "query", entities: [] }));
app.get("/health", (r, s) => s.json({ status: "healthy" }));
const PORT = 5002;
app.listen(PORT, () => console.log("Cognitive on " + PORT));
export default app;