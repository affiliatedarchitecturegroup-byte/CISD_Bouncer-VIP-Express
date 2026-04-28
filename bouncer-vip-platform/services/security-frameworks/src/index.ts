import express from "express";
const app = express();
app.use(express.json());
app.get("/api/nist", (r, s) => s.json({ level: 3 }));
app.get("/api/iso", (r, s) => s.json({ certified: true }));
app.get("/health", (r, s) => s.json({ status: "healthy" }));
const PORT = 4405;
app.listen(PORT, () => console.log("Frameworks on " + PORT));
export default app;