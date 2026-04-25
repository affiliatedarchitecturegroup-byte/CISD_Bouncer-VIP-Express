import express from "express";
const app = express();
app.use(express.json());
app.post("/api/auth/login", (r, s) => s.json({ token: "jwt_xxx", refresh: "rt_xxx" }));
app.post("/api/auth/mfa/verify", (r, s) => s.json({ verified: true }));
app.get("/health", (r, s) => s.json({ status: "healthy" }));
const PORT = 6400;
app.listen(PORT, () => console.log("AuthSecurity on " + PORT));
export default app;