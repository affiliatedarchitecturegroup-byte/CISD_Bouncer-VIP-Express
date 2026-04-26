import express, { Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";

const router = express.Router();

// Inventory alert types
interface StockAlert {
  id: string;
  item_id: string;
  current_stock: number;
  threshold: number;
  severity: "warning" | "critical";
  created_at: Date;
}

const alerts: Map<string, StockAlert> = new Map();

// Check levels
router.get("/check/:item_id", async (req: Request, res: Response) => {
  res.json({ 
    current: 50, 
    threshold: 20, 
    status: "ok" 
  });
});

// Get active alerts
router.get("/alerts", async (req: Request, res: Response) => {
  res.json({ alerts: Array.from(alerts.values()) });
});

// Create alert
router.post("/alerts", async (req: Request, res: Response) => {
  const alert: StockAlert = {
    id: uuidv4(),
    ...req.body,
    created_at: new Date()
  };
  alerts.set(alert.id, alert);
  res.json(alert);
});

// Acknowledge alert
router.put("/alerts/:id/acknowledge", async (req: Request, res: Response) => {
  alerts.delete(req.params.id);
  res.json({ acknowledged: true });
});

export default router;