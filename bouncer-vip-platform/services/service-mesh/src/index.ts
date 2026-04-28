import express from "express";
const app = express();
app.use(express.json());
app.get("/api/mesh/services", (r, s) => s.json({ services: [] }));
app.get("/health", (r, s) => s.json({ status: "healthy" }));
const PORT = 6503;
app.listen(PORT, () => console.log("ServiceMesh on " + PORT));
export default app;