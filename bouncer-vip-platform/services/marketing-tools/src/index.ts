import express from "express";
const app = express();
app.use(express.json());
app.post("/api/email/send", (r, s) => s.json({ sent: true, message_id: "m1" }));
app.post("/api/sms/send", (r, s) => s.json({ sent: true }));
app.get("/health", (r, s) => s.json({ status: "healthy" }));
const PORT = 6202;
app.listen(PORT, () => console.log("MarketingTools on " + PORT));
export default app;