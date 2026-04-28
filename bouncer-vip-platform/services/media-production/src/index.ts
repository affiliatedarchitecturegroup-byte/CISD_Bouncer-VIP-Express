import express from "express";
const app = express();
app.use(express.json());
app.get("/api/stream", (r, s) => s.json({ live: false }));
app.post("/api/content", (r, s) => s.json({ content_id: "c1" }));
app.get("/health", (r, s) => s.json({ status: "healthy" }));
const PORT = 5605;
app.listen(PORT, () => console.log("MediaProduction on " + PORT));
export default app;