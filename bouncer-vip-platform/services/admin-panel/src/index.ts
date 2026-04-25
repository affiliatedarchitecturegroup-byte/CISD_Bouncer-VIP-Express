import express from "express";
const app = express();
app.use(express.json());
app.get("/api/admin/config", (r, s) => s.json({ settings: {} }));
app.get("/api/admin/users", (r, s) => s.json({ users: [] }));
app.get("/health", (r, s) => s.json({ status: "healthy" }));
const PORT = 6005;
app.listen(PORT, () => console.log("AdminPanel on " + PORT));
export default app;