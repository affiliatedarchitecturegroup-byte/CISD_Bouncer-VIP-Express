import express from "express";
const app = express();
app.use(express.json());
app.post("/api/rfid/read", (r, s) => s.json({ tag_id: "rfid_123", access: true }));
app.post("/api/biometric/verify", (r, s) => s.json({ verified: true }));
app.get("/health", (r, s) => s.json({ status: "healthy" }));
const PORT = 6100;
app.listen(PORT, () => console.log("AccessControlHW on " + PORT));
export default app;