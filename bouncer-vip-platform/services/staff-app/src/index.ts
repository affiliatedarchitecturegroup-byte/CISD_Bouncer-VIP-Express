import express from "express";
const app = express();
app.use(express.json());
app.get("/api/shifts", (r, s) => s.json({ shifts: [] }));
app.post("/api/task/assign", (r, s) => s.json({ assigned: true }));
app.get("/health", (r, s) => s.json({ status: "healthy" }));
const PORT = 6001;
app.listen(PORT, () => console.log("StaffApp on " + PORT));
export default app;