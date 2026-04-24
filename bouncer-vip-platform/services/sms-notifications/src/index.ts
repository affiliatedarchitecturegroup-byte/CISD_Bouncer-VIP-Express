import express from "express";
const app = express();
app.use(express.json());
app.post("/api/send", (r, s) => s.json({ success: true, message_id: "sms1" }));
app.get("/health", (r, s) => s.json({ status: "healthy" }));
const PORT = 3801;
app.listen(PORT, () => console.log("SMS on " + PORT));
export default app;