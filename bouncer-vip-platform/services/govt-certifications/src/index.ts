import express from "express";
const app = express();
app.use(express.json());
app.get("/api/fedramp", (r, s) => s.json({ authorized: true }));
app.get("/api/fisma", (r, s) => s.json({ compliant: true }));
app.get("/health", (r, s) => s.json({ status: "healthy" }));
const PORT = 4400;
app.listen(PORT, () => console.log("GovtCert on " + PORT));
export default app;