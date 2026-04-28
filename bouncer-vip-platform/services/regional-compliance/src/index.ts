import express from "express";
const app = express();
app.use(express.json());
app.get("/api/kenya", (r, s) => s.json({ compliant: true }));
app.get("/api/nigeria", (r, s) => s.json({ compliant: true }));
app.get("/health", (r, s) => s.json({ status: "healthy" }));
const PORT = 4403;
app.listen(PORT, () => console.log("Regional on " + PORT));
export default app;