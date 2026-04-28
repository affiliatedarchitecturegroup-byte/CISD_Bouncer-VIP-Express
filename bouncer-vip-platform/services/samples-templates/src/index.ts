import express from "express";
const app = express();
app.use(express.json());
const samples = ["react-starter", "node-api", "mobile-app"];
app.get("/api/samples", (r, s) => s.json({ data: samples }));
app.get("/health", (r, s) => s.json({ status: "healthy" }));
const PORT = 4205;
app.listen(PORT, () => console.log("Samples on " + PORT));
export default app;