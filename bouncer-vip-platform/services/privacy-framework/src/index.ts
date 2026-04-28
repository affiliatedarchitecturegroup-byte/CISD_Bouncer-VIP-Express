import express from "express";
const app = express();
app.use(express.json());
app.get("/api/ccpa", (r, s) => s.json({ compliant: true }));
app.get("/api/lgpd", (r, s) => s.json({ compliant: true }));
app.get("/health", (r, s) => s.json({ status: "healthy" }));
const PORT = 4401;
app.listen(PORT, () => console.log("Privacy on " + PORT));
export default app;