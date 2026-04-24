import express from "express";
const app = express();
app.use(express.json());
app.post("/api/identity/issue", (r, s) => s.json({ credential: "vc1", proof: {} }));
app.post("/api/identity/verify", (r, s) => s.json({ verified: true, claims: {} }));
app.get("/health", (r, s) => s.json({ status: "healthy" }));
const PORT = 5004;
app.listen(PORT, () => console.log("UniversalID on " + PORT));
export default app;