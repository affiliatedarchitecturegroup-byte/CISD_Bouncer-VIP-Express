import express from "express";
const app = express();
app.use(express.json());
app.get("/api/isv", (r, s) => s.json({ data: [] }));
app.get("/health", (r, s) => s.json({ status: "healthy" }));
const PORT = 4302;
app.listen(PORT, () => console.log("ISV on " + PORT));
export default app;