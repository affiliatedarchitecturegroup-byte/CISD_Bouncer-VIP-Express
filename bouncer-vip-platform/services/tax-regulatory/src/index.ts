import express from "express";
const app = express();
app.use(express.json());
app.get("/api/alcohol-tax", (r, s) => s.json({ due: 5000 }));
app.get("/api/sales-tax", (r, s) => s.json({ collected: 12000 }));
app.get("/health", (r, s) => s.json({ status: "healthy" }));
const PORT = 5405;
app.listen(PORT, () => console.log("TaxRegulatory on " + PORT));
export default app;