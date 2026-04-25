import express from "express";
const app = express();
app.use(express.json());
app.get("/api/compliance/soc2", (r, s) => s.json({ compliant: true }));
app.get("/api/compliance/pci", (r, s) => s.json({ compliant: true }));
app.get("/health", (r, s) => s.json({ status: "healthy" }));
const PORT = 6403;
app.listen(PORT, () => console.log("ComplianceMgmt on " + PORT));
export default app;