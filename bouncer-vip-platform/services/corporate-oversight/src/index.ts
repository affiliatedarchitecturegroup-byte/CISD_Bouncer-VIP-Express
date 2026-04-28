import express from "express";
const app = express();
app.use(express.json());
app.get("/api/consolidated", (r, s) => s.json({ revenue: 1000000 }));
app.get("/api/governance", (r, s) => s.json({ policies: [] }));
app.get("/health", (r, s) => s.json({ status: "healthy" }));
const PORT = 5505;
app.listen(PORT, () => console.log("CorpOversight on " + PORT));
export default app;