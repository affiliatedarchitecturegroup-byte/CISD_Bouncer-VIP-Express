import express from "express";
const app = express();
app.use(express.json());
app.post("/api/search", (r, s) => s.json({ results: [], total: 0 }));
app.get("/api/facets", (r, s) => s.json({ facets: {} }));
app.get("/health", (r, s) => s.json({ status: "healthy" }));
const PORT = 4904;
app.listen(PORT, () => console.log("SemanticSearch on " + PORT));
export default app;