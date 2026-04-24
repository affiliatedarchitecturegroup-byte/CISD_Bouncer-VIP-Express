import express from "express";
const app = express();
app.use(express.json());
const regions = ["uk", "germany", "france"];
app.get("/api/regions", (r, s) => s.json({ data: regions }));
app.get("/health", (r, s) => s.json({ status: "healthy" }));
const PORT = 4503;
app.listen(PORT, () => console.log("Europe on " + PORT));
export default app;