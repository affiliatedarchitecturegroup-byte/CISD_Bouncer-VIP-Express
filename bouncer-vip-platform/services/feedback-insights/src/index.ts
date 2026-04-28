import express, { Request, Response } from "express";

const router = express.Router();

// Feedback insights
router.get("/trends", async (req: Request, res: Response) => {
  res.json({ trends: [] });
});

export default router;