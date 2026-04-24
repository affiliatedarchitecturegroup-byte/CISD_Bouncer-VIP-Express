import express from "express";
const app = express();
app.use(express.json());
app.get("/api/quantum/keys", (r, s) => s.json({ algorithm: "CRYSTALS-Kyber" }));
app.post("/api/hybrid", (r, s) => s.json({ encrypted: true, hybrid: true }));
app.get("/health", (r, s) => s.json({ status: "healthy" }));
const PORT = 4800;
app.listen(PORT, () => console.log("Quantum on " + PORT));
export default app;