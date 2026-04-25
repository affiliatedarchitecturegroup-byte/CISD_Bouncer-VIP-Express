import express from "express";
const app = express();
app.use(express.json());
app.post("/api/stripe/charge", (r, s) => s.json({ id: "ch_xxx", status: "succeeded" }));
app.post("/api/square/payment", (r, s) => s.json({ payment_id: "sq_xxx" }));
app.get("/health", (r, s) => s.json({ status: "healthy" }));
const PORT = 6200;
app.listen(PORT, () => console.log("PaymentGateways on " + PORT));
export default app;