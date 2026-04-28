import express, { Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";

const router = express.Router();

// Mobile ordering types
interface OrderItem {
  menu_item_id: string;
  name: string;
  quantity: number;
  price: number;
  notes?: string;
}

interface Order {
  id: string;
  guest_id: string;
  table_id: string;
  items: OrderItem[];
  status: "received" | "preparing" | "ready" | "served";
  total: number;
  created_at: Date;
}

const orders: Map<string, Order> = new Map();

// Create order
router.post("/", async (req: Request, res: Response) => {
  const items: OrderItem[] = req.body.items || [];
  const total = items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
  
  const order: Order = {
    id: uuidv4(),
    guest_id: req.body.guest_id,
    table_id: req.body.table_id,
    items,
    status: "received",
    total,
    created_at: new Date()
  };
  orders.set(order.id, order);
  res.status(201).json(order);
});

// Get order status
router.get("/:order_id", async (req: Request, res: Response) => {
  const order = orders.get(req.params.order_id);
  if (!order) return res.status(404).json({ error: "Order not found" });
  res.json(order);
});

// Update order status
router.put("/:order_id/status", async (req: Request, res: Response) => {
  const order = orders.get(req.params.order_id);
  if (!order) return res.status(404).json({ error: "Order not found" });
  
  order.status = req.body.status;
  orders.set(order.id, order);
  res.json(order);
});

// Get active orders
router.get("/table/:table_id", async (req: Request, res: Response) => {
  const tableOrders = Array.from(orders.values())
    .filter(o => o.table_id === req.params.table_id && o.status !== "served");
  res.json({ orders: tableOrders });
});

// Cancel order
router.delete("/:order_id", async (req: Request, res: Response) => {
  const order = orders.get(req.params.order_id);
  if (!order) return res.status(404).json({ error: "Order not found" });
  
  if (order.status !== "received") {
    return res.status(400).json({ error: "Cannot cancel order in progress" });
  }
  
  orders.delete(order.id);
  res.status(204).send();
});

export default router;