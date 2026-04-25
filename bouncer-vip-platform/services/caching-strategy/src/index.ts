import express from "express";
const app = express();
app.use(express.json());
app.get("/api/cache/status", (r, s) => s.json({ hit_rate: 0.85, keys: 10000 }));
app.post("/api/cache/invalidate", (r, s) => s.json({ invalidated: true }));
app.get("/health", (r, s) => s.json({ status: "healthy" }));
const PORT = 6501;
app.listen(PORT, () => console.log("CachingStrategy on " + PORT));
export default app;