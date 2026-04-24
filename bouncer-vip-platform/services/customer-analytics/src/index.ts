import express from "express";
const app = express();
app.use(express.json());
app.get("/api/clv", (r, s) => s.json({ clv: 2500 }));
app.get("/api/churn", (r, s) => s.json({ risk: 0.1 }));
app.get("/health", (r, s) => s.json({ status: "healthy" }));
const PORT = 5801;
app.listen(PORT, () => console.log("CustomerAnalytics on " + PORT));
export default app;