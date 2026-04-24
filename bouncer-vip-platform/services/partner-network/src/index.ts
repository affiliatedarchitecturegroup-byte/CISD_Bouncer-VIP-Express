import express from "express";
const app = express();
app.use(express.json());
app.get("/api/partners", (r, s) => s.json({ data: [] }));
app.post("/api/certify", (r, s) => s.json({ certified: true }));
app.get("/health", (r, s) => s.json({ status: "healthy" }));
const PORT = 4301;
app.listen(PORT, () => console.log("Partner on " + PORT));
export default app;