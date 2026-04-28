import express, { Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";

const router = express.Router();

// Mobile user types
interface MobileUser {
  id: string;
  guest_id: string;
  device_token: string;
  os: "ios" | "android";
  last_login: Date;
}

// Mobile auth
router.post("/auth/login", async (req: Request, res: Response) => {
  const user: MobileUser = {
    id: uuidv4(),
    guest_id: req.body.guest_id,
    device_token: req.body.device_token,
    os: req.body.os,
    last_login: new Date()
  };
  res.json({ 
    user, 
    token: uuidv4(),
    expires_in: 3600 
  });
});

// Guest check-in via mobile
router.post("/checkin", async (req: Request, res: Response) => {
  const { guest_id, venue_id } = req.body;
  res.json({
    checkin_id: uuidv4(),
    guest_id,
    venue_id,
    status: "confirmed",
    timestamp: new Date().toISOString()
  });
});

// Mobile ordering
router.post("/order", async (req: Request, res: Response) => {
  const { guest_id, items, table_id } = req.body;
  const order = {
    id: uuidv4(),
    guest_id,
    items,
    table_id,
    status: "received",
    created_at: new Date()
  };
  res.json(order);
});

// Get order status
router.get("/order/:id", async (req: Request, res: Response) => {
  res.json({
    id: req.params.id,
    status: "preparing",
    estimated_time: 15
  });
});

export default router;