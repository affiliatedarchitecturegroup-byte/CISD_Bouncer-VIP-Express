import express from "express";
const app = express();
app.use(express.json());
app.post("/api/explore", (r, s) => s.json({ endpoints: [], method: "GET" }));
app.get("/api/code", (r, s) => s.json({ code: "const client = new API()" }));
app.get("/health", (r, s) => s.json({ status: "healthy" }));
const PORT = 4204;
app.listen(PORT, () => console.log("Explorer on " + PORT));
export default app;