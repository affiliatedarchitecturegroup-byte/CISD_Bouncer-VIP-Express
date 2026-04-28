import express from "express";
const app = express();
app.use(express.json());
app.get("/api/recommendations/:user", (r, s) => s.json({ recommended: ["table_5", "bottle_x"] }));
app.get("/api/personalize/:user", (r, s) => s.json({ content: [] }));
app.get("/health", (r, s) => s.json({ status: "healthy" }));
const PORT = 6301;
app.listen(PORT, () => console.log("Personalization on " + PORT));
export default app;