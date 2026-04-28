import express, { Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";

const router = express.Router();

// Kitchen types
interface KitchenOrder {
  id: string;
  table_id: string;
  items: any[];
  status: "received" | "cooking" | "ready" | "served";
  priority: "normal" | "rush";
}

// Submit order
router.post("/orders", async (req: Request, res: Response) => {
  const order: KitchenOrder = {
    id: uuidv4(),
    table_id: req.body.table_id,
    items: req.body.items,
    status: "received",
    priority: req.body.rush ? "rush" : "normal"
  };
  res.json(order);
});

// Status update
router.put("/orders/:id/status", async (req: Request, res: Response) => {
  res.json({ id: req.params.id, status: req.body.status });
});

// Kitchen tickets
router.get("/tickets", async (req: Request, res: Response) => {
  res.json({ tickets: [], pending: 0, cooking: 0 });
});

export default router;