import express from "express";
const app = express();
app.use(express.json());
app.get("/api/themes", (r, s) => s.json({ data: [{ id: "default", name: "Default" }] }));
app.post("/api/branding", (r, s) => s.json({ applied: true }));
app.get("/health", (r, s) => s.json({ status: "healthy" }));
const PORT = 4104;
app.listen(PORT, () => console.log("WhiteLabel on " + PORT));
export default app;