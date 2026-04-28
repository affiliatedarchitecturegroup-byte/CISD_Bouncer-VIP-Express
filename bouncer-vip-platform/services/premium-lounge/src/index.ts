import express, { Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";

const router = express.Router();

// Premium lounge types
interface LoungeAccess {
  guest_id: string;
  tier_required: string;
  valid_until?: Date;
}

interface LoungeService {
  id: string;
  name: string;
  description: string;
  included_in: string[];
}

// Check access
router.get("/access/:guest_id", async (req: Request, res: Response) => {
  const tier = req.query.tier as string || "gold";
  const access = tier !== "none" && tier !== "bronze";
  res.json({
    guest_id: req.params.guest_id,
    has_access: access,
    tier_required: "silver"
  });
});

// Lounge services
router.get("/services", async (req: Request, res: Response) => {
  res.json({
    services: [
      { id: "s1", name: "Private Bar", description: "Exclusive bar", tiers: ["silver", "gold", "platinum", "diamond"] },
      { id: "s2", name: "Concierge", description: "Personal service", tiers: ["gold", "platinum", "diamond"] },
      { id: "s3", name: "VIP Entrance", description: "Separate entrance", tiers: ["platinum", "diamond"] }
    ]
  });
});

// Log lounge visit
router.post("/visit", async (req: Request, res: Response) => {
  res.json({
    visit_id: uuidv4(),
    guest_id: req.body.guest_id,
    check_in: new Date().toISOString()
  });
});

// Usage analytics
router.get("/analytics", async (req: Request, res: Response) => {
  res.json({
    total_visits_today: 45,
    avg_duration: 120, // minutes
    most_popular_service: "Private Bar",
    by_tier: { silver: 20, gold: 15, platinum: 8, diamond: 2 }
  });
});

export default router;