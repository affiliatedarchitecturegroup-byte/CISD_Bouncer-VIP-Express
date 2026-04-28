import express, { Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";

const router = express.Router();

// Bottle service types
interface BottlePackage {
  id: string;
  name: string;
  contents: string[];
  price: number;
  valid_for: number;
}

const packages: BottlePackage[] = [
  { id: "b1", name: "Silver", contents: ["1x Premium Whiskey", "Mixers"], price: 1500, valid_for: 4 },
  { id: "b2", name: "Gold", contents: ["2x Champagne", "Appetizers"], price: 3000, valid_for: 6 },
  { id: "b3", name: "Platinum", contents: ["3x Premium", "Full Service"], price: 5000, valid_for: 8 },
];

// Get packages
router.get("/packages", async (req: Request, res: Response) => {
  res.json({ packages });
});

// Order bottle
router.post("/order", async (req: Request, res: Response) => {
  const { guest_id, package_id, table_id } = req.body;
  const pkg = packages.find(p => p.id === package_id);
  
  res.json({
    order_id: uuidv4(),
    package: pkg,
    table_id,
    status: "confirmed",
    estimated_delivery: "10 min"
  });
});

// Track delivery
router.get("/delivery/:order_id", async (req: Request, res: Response) => {
  res.json({
    order_id: req.params.order_id,
    status: "en_route",
    estimated_arrival: "3 min"
  });
});

// Consumption tracking
router.get("/consumption/:guest_id", async (req: Request, res: Response) => {
  res.json({
    guest_id: req.params.guest_id,
    bottles_ordered: 3,
    total_spent: 9000,
    favorite: "Champagne"
  });
});

export default router;