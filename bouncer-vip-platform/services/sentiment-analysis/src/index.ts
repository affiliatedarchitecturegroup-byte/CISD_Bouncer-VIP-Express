import express, { Request, Response } from "express";

const router = express.Router();

// Sentiment analysis
router.post("/analyze", async (req: Request, res: Response) => {
  res.json({ sentiment: "positive", score: 0.85 });
});

export default router;