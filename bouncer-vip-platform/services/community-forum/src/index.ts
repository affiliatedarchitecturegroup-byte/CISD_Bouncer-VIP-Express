import express from "express";
const app = express();
app.use(express.json());
app.get("/api/threads", (r, s) => s.json({ data: [] }));
app.post("/api/discuss", (r, s) => s.json({ created: true }));
app.get("/health", (r, s) => s.json({ status: "healthy" }));
const PORT = 4303;
app.listen(PORT, () => console.log("Community on " + PORT));
export default app;