import express from "express";
const app = express();
app.use(express.json());
const regions = ["brazil", "mexico", "argentina"];
app.get("/api/regions", (r, s) => s.json({ data: regions }));
app.get("/health", (r, s) => s.json({ status: "healthy" }));
const PORT = 4504;
app.listen(PORT, () => console.log("LATAM on " + PORT));
export default app;