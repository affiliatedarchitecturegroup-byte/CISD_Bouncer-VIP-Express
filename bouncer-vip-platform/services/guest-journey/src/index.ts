import express, { Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";

const router = express.Router();

// Guest journey tracking
interface JourneyStage {
  guest_id: string;
  stage: string;
  touchpoints: string[];
  last_updated: Date;
}

const journeys: Map<string, JourneyStage> = new Map();

// Track guest journey
router.post("/track", async (req: Request, res: Response) => {
  const journey: JourneyStage = {
    guest_id: req.body.guest_id,
    stage: req.body.stage || "awareness",
    touchpoints: req.body.touchpoints || [],
    last_updated: new Date()
  };
  journeys.set(journey.guest_id, journey);
  res.json(journey);
});

// Get journey
router.get("/:guest_id", async (req: Request, res: Response) => {
  const journey = journeys.get(req.params.guest_id);
  res.json(journey || { guest_id: req.params.guest_id, stage: "new", touchpoints: [] });
});

// Analytics
router.get("/analytics", async (req: Request, res: Response) => {
  res.json({
    by_stage: {
      awareness: 4500,
      interest: 2800,
      consideration: 1200,
      conversion: 850
    },
    avg_time_to_convert: 14
  });
});

export default router;