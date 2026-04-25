import express from "express";
const app = express();
app.use(express.json());
app.get("/api/mobile/status", (r, s) => s.json({ version: "1.0.0", latest: true }));
app.post("/api/mobile/checkin", (r, s) => s.json({ checked_in: true }));
app.get("/health", (r, s) => s.json({ status: "healthy" }));
const PORT = 6000;
app.listen(PORT, () => console.log("GuestMobile on " + PORT));
export default app;