import express from "express";
const app = express();
app.use(express.json());
app.get("/api/docs", (r, s) => s.json({ guides: [], examples: [] }));
app.get("/health", (r, s) => s.json({ status: "healthy" }));
const PORT = 4202;
app.listen(PORT, () => console.log("Docs on " + PORT));
export default app;