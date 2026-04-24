import express from "express";
const app = express();
app.use(express.json());
app.get("/api/preferences/:user", (r, s) => s.json({ push: true, email: true, sms: true, quiet_hours: null }));
app.put("/api/preferences/:user", (r, s) => s.json({ success: true }));
app.get("/health", (r, s) => s.json({ status: "healthy" }));
const PORT = 3804;
app.listen(PORT, () => console.log("Prefs on " + PORT));
export default app;