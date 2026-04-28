import express from "express";
const app = express();
app.use(express.json());
app.get("/api/hipaa", (r, s) => s.json({ compliant: true }));
app.get("/api/pci", (r, s) => s.json({ compliant: true }));
app.get("/health", (r, s) => s.json({ status: "healthy" }));
const PORT = 4402;
app.listen(PORT, () => console.log("Industry on " + PORT));
export default app;