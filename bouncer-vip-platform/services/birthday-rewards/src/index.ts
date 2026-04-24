import express from "express";
const app = express();
app.use(express.json());
app.get("/api/birthday-bonus", (r, s) => s.json({ bonus: 500, valid: true }));
app.post("/api/birthday/claim", (r, s) => s.json({ claimed: true }));
app.get("/health", (r, s) => s.json({ status: "healthy" }));
const PORT = 5703;
app.listen(PORT, () => console.log("BirthdayRewards on " + PORT));
export default app;