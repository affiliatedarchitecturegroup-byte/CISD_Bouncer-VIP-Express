import express, { Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";

const router = express.Router();

interface VIPTier {
  id: string;
  name: string;
  annual_fee: number;
  benefits: string[];
  color: string;
}

interface VIPMembership {
  id: string;
  guest_id: string;
  tier: string;
  start_date: Date;
  end_date: Date;
  status: "active" | "expired" | "cancelled";
  points: number;
}

const tiers: VIPTier[] = [
  { id: "bronze", name: "Bronze", annual_fee: 5000, benefits: ["Priority entry", "Dedicated host"], color: "#CD7F32" },
  { id: "silver", name: "Silver", annual_fee: 15000, benefits: ["Priority entry", "Free drinks", "Lounge access"], color: "#C0C0C0" },
  { id: "gold", name: "Gold", annual_fee: 50000, benefits: ["VIP entrance", "Bottle service", "Private booth"], color: "#FFD700" },
  { id: "platinum", name: "Platinum", annual_fee: 150000, benefits: ["All gold", "Limousine", "Personal security"], color: "#E5E4E2" },
  { id: "diamond", name: "Diamond", annual_fee: 500000, benefits: ["All platinum", "Private jet", "Direct line"], color: "#B9F2FF" },
];

const memberships: Map<string, VIPMembership> = new Map();

// Get tiers
router.get("/tiers", async (req: Request, res: Response) => {
  res.json({ tiers });
});

// Create membership
router.post("/memberships", async (req: Request, res: Response) => {
  const m: VIPMembership = {
    id: uuidv4(),
    guest_id: req.body.guest_id,
    tier: req.body.tier,
    start_date: new Date(),
    end_date: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    status: "active",
    points: 0
  };
  memberships.set(m.id, m);
  res.status(201).json(m);
});

// Get memberships
router.get("/memberships", async (req: Request, res: Response) => {
  const tier = req.query.tier as string;
  let list = Array.from(memberships.values());
  if (tier) list = list.filter(m => m.tier === tier);
  res.json({ memberships: list });
});

// Add points
router.put("/memberships/:id/points", async (req: Request, res: Response) => {
  const m = memberships.get(req.params.id);
  if (!m) return res.status(404).json({ error: "Not found" });
  m.points += req.body.points || 0;
  memberships.set(m.id, m);
  res.json(m);
});

// Analytics
router.get("/analytics", async (req: Request, res: Response) => {
  const list = Array.from(memberships.values());
  res.json({
    total: list.length,
    by_tier: {
      bronze: list.filter(m => m.tier === "bronze").length,
      silver: list.filter(m => m.tier === "silver").length,
      gold: list.filter(m => m.tier === "gold").length,
      platinum: list.filter(m => m.tier === "platinum").length,
      diamond: list.filter(m => m.tier === "diamond").length
    },
    total_points: list.reduce((s, m) => s + m.points, 0)
  });
});

export default router;