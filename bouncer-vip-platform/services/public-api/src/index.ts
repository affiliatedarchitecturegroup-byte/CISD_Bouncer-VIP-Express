import express from "express";
const app = express();
app.use(express.json());
const endpoints = ["/api/v1/guests", "/api/v1/events", "/api/v1/tables"];
app.get("/api/v1/:resource", (r, s) => s.json({ data: [] }));
app.get("/health", (r, s) => s.json({ status: "healthy" }));
const PORT = 5900;
app.listen(PORT, () => console.log("PublicAPI on " + PORT));
export default app;