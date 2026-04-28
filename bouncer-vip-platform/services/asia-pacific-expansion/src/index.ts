import express from "express";
const app = express();
app.use(express.json());
const regions = ["india", "singapore", "australia"];
app.get("/api/regions", (r, s) => s.json({ data: regions }));
app.get("/health", (r, s) => s.json({ status: "healthy" }));
const PORT = 4502;
app.listen(PORT, () => console.log("APAC on " + PORT));
export default app;