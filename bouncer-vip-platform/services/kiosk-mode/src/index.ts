import express from "express";
const app = express();
app.use(express.json());
app.post("/api/kiosk/checkin", (r, s) => s.json({ success: true, queue_position: 5 }));
app.post("/api/kiosk/verify", (r, s) => s.json({ verified: true }));
app.get("/health", (r, s) => s.json({ status: "healthy" }));
const PORT = 6004;
app.listen(PORT, () => console.log("KioskMode on " + PORT));
export default app;