import express from "express";
const app = express();
app.use(express.json());
app.post("/api/delivery/order", (r, s) => s.json({ order_id: "d1", status: "pending" }));
app.get("/api/delivery/status", (r, s) => s.json({ active: [] }));
app.get("/health", (r, s) => s.json({ status: "healthy" }));
const PORT = 6205;
app.listen(PORT, () => console.log("DeliveryPlatforms on " + PORT));
export default app;