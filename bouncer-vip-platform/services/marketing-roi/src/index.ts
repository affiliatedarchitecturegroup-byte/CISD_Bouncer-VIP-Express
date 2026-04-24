import express from "express";
const app = express();
app.use(express.json());
app.get("/api/campaigns", (r, s) => s.json({ roi: 3.5 }));
app.get("/api/attribution", (r, s) => s.json({ channels: {} }));
app.get("/health", (r, s) => s.json({ status: "healthy" }));
const PORT = 5803;
app.listen(PORT, () => console.log("MarketingROI on " + PORT));
export default app;