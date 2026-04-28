import express from "express";
const app = express();
app.use(express.json());

app.get("/api/oauth/authorize", (r, s) => s.json({ code: "abc123" }));
app.post("/api/oauth/token", (r, s) => s.json({ access_token: "tok", expires_in: 3600 }));
app.post("/api/mfa/verify", (r, s) => s.json({ verified: true }));
app.get("/health", (r, s) => s.json({ status: "healthy" }));
const PORT = 3700;
app.listen(PORT, () => console.log("Auth Advanced on " + PORT));
export default app;