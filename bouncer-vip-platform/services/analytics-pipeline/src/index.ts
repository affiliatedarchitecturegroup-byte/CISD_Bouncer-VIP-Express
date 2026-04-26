import express, { Request, Response } from "express";

const router = express.Router();

// Analytics pipeline
router.get("/streaming", async (req: Request, res: Response) => {
  res.json({
    events_per_second: 1250,
    queue_depth: 45
  });
});

router.get("/aggregations", async (req: Request, res: Response) => {
  res.json({
    hourly: { guests: 412, revenue: 285000 },
    daily: { guests: 8543, revenue: 1850000 }
  });
});

export default router;