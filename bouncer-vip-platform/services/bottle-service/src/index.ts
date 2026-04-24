import express from "express";
const app = express();
app.use(express.json());
app.get("/api/inventory", (r, s) => s.json({ available: 100 }));
app.post("/api/pour", (r, s) => s.json({ poured: true, remaining: 99 }));
app.get("/health", (r, s) => s.json({ status: "healthy" }));
const PORT = 5302;
app.listen(PORT, () => console.log("BottleSvc on " + PORT));
export default app;