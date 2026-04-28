import express from "express";
const app = express();
app.use(express.json());
app.get("/api/hooks", (r, s) => s.json({ data: [] }));
app.get("/health", (r, s) => s.json({ status: "healthy" }));
const PORT = 4305;
app.listen(PORT, () => console.log("PluginSDK on " + PORT));
export default app;