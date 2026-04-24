import express from "express";
const app = express();
app.use(express.json());
app.post("/api/nlp", (r, s) => s.json({ intent: "booking", entities: [] }));
app.post("/api/sentiment", (r, s) => s.json({ score: 0.8 }));
app.get("/health", (r, s) => s.json({ status: "healthy" }));
const PORT = 3900;
app.listen(PORT, () => console.log("AI on " + PORT));
export default app;