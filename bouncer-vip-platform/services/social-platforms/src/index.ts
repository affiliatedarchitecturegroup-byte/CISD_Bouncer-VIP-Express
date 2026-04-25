import express from "express";
const app = express();
app.use(express.json());
app.post("/api/social/post", (r, s) => s.json({ posted: true, platform: "instagram" }));
app.get("/api/social/analytics", (r, s) => s.json({ followers: 10000 }));
app.get("/health", (r, s) => s.json({ status: "healthy" }));
const PORT = 6201;
app.listen(PORT, () => console.log("SocialPlatforms on " + PORT));
export default app;