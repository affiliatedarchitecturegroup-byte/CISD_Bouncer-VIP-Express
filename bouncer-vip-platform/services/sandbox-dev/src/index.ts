import express from "express";
const app = express();
app.use(express.json());
app.get("/api/sandbox", (r, s) => s.json({ active: true, expire: "24h" }));
app.get("/api/mock", (r, s) => s.json({ services: [] }));
app.get("/health", (r, s) => s.json({ status: "healthy" }));
const PORT = 4203;
app.listen(PORT, () => console.log("Sandbox on " + PORT));
export default app;