import express from "express";
const app = express();
app.use(express.json());
app.post("/api/private/chat", (r, s) => s.json({ response: "private", model: "on-prem" }));
app.post("/api/train", (r, s) => s.json({ trained: true, epochs: 100 }));
app.get("/health", (r, s) => s.json({ status: "healthy" }));
const PORT = 5003;
app.listen(PORT, () => console.log("SovereignAI on " + PORT));
export default app;