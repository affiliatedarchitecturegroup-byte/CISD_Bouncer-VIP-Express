import express from "express";
const app = express();
app.use(express.json());
app.get("/api/regions", (r, s) => s.json({ data: ["us-east", "eu-west", "ap-south"] }));
app.post("/api/select", (r, s) => s.json({ selected: "us-east" }));
app.get("/health", (r, s) => s.json({ status: "healthy" }));
const PORT = 4101;
app.listen(PORT, () => console.log("Multi-region on " + PORT));
export default app;