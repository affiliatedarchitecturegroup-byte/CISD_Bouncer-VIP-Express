import express, { Request, Response } from "express";

const router = express.Router();

// Dashboard types
interface DashboardMetric {
  name: string;
  value: number;
  change: number; // percentage change
  trend: "up" | "down" | "stable";
}

// Get executive summary
router.get("/executive-summary", async (req: Request, res: Response) => {
  const metrics: DashboardMetric[] = [
    { name: "Total Guests", value: 12450, change: 12.5, trend: "up" },
    { name: "VIP Members", value: 843, change: 8.2, trend: "up" },
    { name: "Tonight's Revenue", value: 285000, change: 15.3, trend: "up" },
    { name: "Current Occupancy", value: 412, change: -2.1, trend: "down" },
    { name: "Tables Reserved", value: 28, change: 0, trend: "stable" },
    { name: "Avg Table Spend", value: 4500, change: 5.7, trend: "up" }
  ];
  res.json({ metrics });
});

// Guest analytics
router.get("/guests", async (req: Request, res: Response) => {
  res.json({
    total_guests: 12450,
    new_this_month: 342,
    active_guests: 8934,
    at_risk: 234,
    by_tier: {
      bronze: 4500,
      silver: 3200,
      gold: 2100,
      platinum: 450,
      diamond: 34
    }
  });
});

// Revenue analytics
router.get("/revenue", async (req: Request, res: Response) => {
  res.json({
    today: 285000,
    this_week: 1920000,
    this_month: 7650000,
    by_source: {
      cover_charge: 185000,
      table_service: 4200000,
      bar: 2100000,
      vip_membership: 680000,
      events: 485000
    }
  });
});

export default router;