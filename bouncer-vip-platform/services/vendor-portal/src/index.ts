import express, { Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";

const router = express.Router();

// Vendor types
interface Vendor {
  id: string;
  name: string;
  category: string;
  status: "active" | "inactive";
}

// Register vendor
router.post("/vendors", async (req: Request, res: Response) => {
  const vendor: Vendor = {
    id: uuidv4(),
    name: req.body.name,
    category: req.body.category,
    status: "active"
  };
  res.json(vendor);
});

// Orders to vendor
router.get("/vendor-orders", async (req: Request, res: Response) => {
  res.json({ orders: [] });
});

export default router;