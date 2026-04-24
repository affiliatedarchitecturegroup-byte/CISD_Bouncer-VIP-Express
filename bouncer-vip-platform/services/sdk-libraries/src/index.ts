import express from "express";
const app = express();
app.use(express.json());
const sdks = ["javascript", "python", "ios", "android"];
app.get("/api/sdks", (r, s) => s.json({ data: sdks }));
app.get("/health", (r, s) => s.json({ status: "healthy" }));
const PORT = 4200;
app.listen(PORT, () => console.log("SDK on " + PORT));
export default app;