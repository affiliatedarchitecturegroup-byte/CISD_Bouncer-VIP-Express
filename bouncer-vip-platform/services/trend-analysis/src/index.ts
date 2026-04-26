import express, { Request, Response } from "express";

const router = express.Router();

// Trend analysis
router.get("/patterns", async (req: Request, res: Response) => {
  res.json({ patterns: { peak_days: ["Fri", "Sat"], peak_hours: ["22", "23", "00"] } });
});

export default router;