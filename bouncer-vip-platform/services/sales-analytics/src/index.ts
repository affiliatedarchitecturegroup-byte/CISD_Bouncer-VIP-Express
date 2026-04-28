import express, { Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";

const router = express.Router();

// Sales types
router.get("/forecast", async (req: Request, res: Response) => {
  res.json({
    this_month: 2500000,
    next_month: 2800000,
    confidence: 0.85
  });
});

// Revenue by source
router.get("/by-source", async (req: Request, res: Response) => {
  res.json({
    table_service: { revenue: 1500000, percent: 60 },
    bar: { revenue: 500000, percent: 20 },
    events: { revenue: 500000, percent: 20 }
  });
});

// Performance
router.get("/performance", async (req: Request, res: Response) => {
  res.json({
    reps: 5,
    deals_closed: 12,
    avg_cycle: 14, // days
    conversion_rate: 0.25
  });
});

export default router;