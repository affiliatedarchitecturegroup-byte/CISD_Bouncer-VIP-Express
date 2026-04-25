import express from "express";
const app = express();
app.use(express.json());
app.post("/api/auth/login", (r, s) => s.json({ token: "xxx", user: {} }));
app.get("/api/account", (r, s) => s.json({ preferences: {} }));
app.get("/health", (r, s) => s.json({ status: "healthy" }));
const PORT = 6003;
app.listen(PORT, () => console.log("WebPortal on " + PORT));
export default app;