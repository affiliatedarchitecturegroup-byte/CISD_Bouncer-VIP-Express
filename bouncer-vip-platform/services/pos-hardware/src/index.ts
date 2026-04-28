import express from "express";
const app = express();
app.use(express.json());
app.post("/api/pos/payment", (r, s) => s.json({ approved: true, transaction_id: "t1" }));
app.get("/health", (r, s) => s.json({ status: "healthy" }));
const PORT = 6101;
app.listen(PORT, () => console.log("POSHardware on " + PORT));
export default app;