import express from "express";
const app = express();
app.use(express.json());
const offices = ["kenya", "nigeria", "south-africa"];
app.get("/api/offices", (r, s) => s.json({ data: offices }));
app.get("/health", (r, s) => s.json({ status: "healthy" }));
const PORT = 4500;
app.listen(PORT, () => console.log("Africa on " + PORT));
export default app;