import express from "express";
const app = express();
app.use(express.json());
app.post("/api/chat", (r, s) => s.json({ response: "How can I help?" }));
app.post("/api/transcribe", (r, s) => s.json({ text: "transcribed" }));
app.get("/health", (r, s) => s.json({ status: "healthy" }));
const PORT = 6303;
app.listen(PORT, () => console.log("NLP on " + PORT));
export default app;