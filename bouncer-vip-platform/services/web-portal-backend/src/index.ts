import express, { Request, Response } from "express";

const router = express.Router();

// Portal types
interface PortalUser {
  guest_id: string;
  email: string;
  role: "member" | "staff" | "manager" | "admin";
}

// Portal stats
router.get("/stats", async (req: Request, res: Response) => {
  res.json({
    active_members: 8543,
    total_bookings_today: 142,
    current_occupancy: 412,
    revenue_today: 285000
  });
});

// Member profile
router.get("/profile/:guest_id", async (req: Request, res: Response) => {
  res.json({
    guest_id: req.params.guest_id,
    vip_tier: "gold",
    points: 15420,
    visits_this_month: 4,
    total_spent: 45600
  });
});

// Book table
router.post("/book-table", async (req: Request, res: Response) => {
  res.json({
    booking_id: "bk_" + Date.now(),
    status: "confirmed",
    table: "Table 5",
    date: req.body.date,
    time: req.body.time
  });
});

// Admin - manage guests
router.get("/admin/guests", async (req: Request, res: Response) => {
  res.json({ guests: [], total: 12450, page: 1 });
});

// Admin - venue settings
router.get("/admin/venue-settings", async (req: Request, res: Response) => {
  res.json({
    venue_name: "Bouncer VIP",
    capacity: 800,
    operating_hours: "21:00 - 04:00",
    vip_tiers: ["bronze", "silver", "gold", "platinum", "diamond"]
  });
});

export default router;