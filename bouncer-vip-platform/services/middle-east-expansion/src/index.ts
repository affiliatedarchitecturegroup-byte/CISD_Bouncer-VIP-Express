import express from "express";
const app = express();
app.use(express.json());
const regions = ["uae", "saudi", "qatar"];
app.get("/api/regions", (r, s) => s.json({ data: regions }));
app.get("/health", (r, s) => s.json({ status: "healthy" }));
const PORT = 4501;
app.listen(PORT, () => console.log("ME on " + PORT));
export default app;