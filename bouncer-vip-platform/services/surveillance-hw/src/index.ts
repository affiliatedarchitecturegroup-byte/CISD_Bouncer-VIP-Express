import express from "express";
const app = express();
app.use(express.json());
app.get("/api/cameras", (r, s) => s.json({ cameras: [] }));
app.post("/api/recording/start", (r, s) => s.json({ recording: true }));
app.get("/health", (r, s) => s.json({ status: "healthy" }));
const PORT = 6103;
app.listen(PORT, () => console.log("SurveillanceHW on " + PORT));
export default app;