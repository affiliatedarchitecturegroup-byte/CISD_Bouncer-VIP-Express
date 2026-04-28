import express, { Request, Response } from "express";

const router = express.Router();

// Revenue forecast
router.get("/monthly", async (req: Request, res: Response) => {
  res.json({ forecast: 3500000, confidence: 0.85 });
});

export default router;