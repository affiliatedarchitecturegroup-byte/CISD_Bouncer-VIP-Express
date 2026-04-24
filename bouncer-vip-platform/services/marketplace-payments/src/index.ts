import express from "express";
const app = express();
app.use(express.json());
app.get("/api/invoices", (r, s) => s.json({ data: [] }));
app.get("/api/revenue", (r, s) => s.json({ amount: 0 }));
app.get("/health", (r, s) => s.json({ status: "healthy" }));
const PORT = 4304;
app.listen(PORT, () => console.log("MktPay on " + PORT));
export default app;