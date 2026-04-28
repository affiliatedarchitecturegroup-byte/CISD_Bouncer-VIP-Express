import express from "express";
const app = express();
app.use(express.json());
app.get("/api/bci/status", (r, s) => s.json({ connected: false }));
app.post("/api/neural/auth", (r, s) => s.json({ authenticated: true }));
app.get("/health", (r, s) => s.json({ status: "healthy" }));
const PORT = 4804;
app.listen(PORT, () => console.log("Neural on " + PORT));
export default app;