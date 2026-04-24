import express from "express";
const app = express();
app.use(express.json());
app.post("/api/chat", (r, s) => s.json({ response: "Hello!", intent: "greeting" }));
app.post("/api/voice", (r, s) => s.json({ transcript: "Hello", response: "Hi there" }));
app.get("/health", (r, s) => s.json({ status: "healthy" }));
const PORT = 3902;
app.listen(PORT, () => console.log("Chatbot on " + PORT));
export default app;