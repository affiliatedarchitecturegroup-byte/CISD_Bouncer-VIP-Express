import express from "express";
const app = express();
app.use(express.json());
app.get("/api/calendar/sync", (r, s) => s.json({ events: [] }));
app.post("/api/calendar/event", (r, s) => s.json({ created: true }));
app.get("/health", (r, s) => s.json({ status: "healthy" }));
const PORT = 6204;
app.listen(PORT, () => console.log("CalendarSync on " + PORT));
export default app;