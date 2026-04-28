import express from "express";
const app = express();
app.use(express.json());
app.get("/api/bts", (r, s) => s.json({ available: true }));
app.post("/api/meet-greet", (r, s) => s.json({ booked: true }));
app.get("/health", (r, s) => s.json({ status: "healthy" }));
const PORT = 5603;
app.listen(PORT, () => console.log("VIPExperiences on " + PORT));
export default app;