import express, { Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";

const router = express.Router();

// Inventory types
interface InventoryItem {
  id: string;
  name: string;
  category: string;
  quantity: number;
  unit: string;
  par_level: number;
  reorder_point: number;
  cost_per_unit: number;
  supplier_id?: string;
  last_restocked?: Date;
}

interface StockMovement {
  id: string;
  item_id: string;
  type: "in" | "out" | "adjustment";
  quantity: number;
  reason: string;
  timestamp: Date;
}

// Storage
const inventory: Map<string, InventoryItem> = new Map();
const movements: Map<string, StockMovement> = new Map();

// Add inventory item
router.post("/", async (req: Request, res: Response) => {
  const item: InventoryItem = {
    id: uuidv4(),
    name: req.body.name,
    category: req.body.category,
    quantity: req.body.quantity || 0,
    unit: req.body.unit || "each",
    par_level: req.body.par_level || 10,
    reorder_point: req.body.reorder_point || 5,
    cost_per_unit: req.body.cost_per_unit || 0,
    supplier_id: req.body.supplier_id
  };
  
  inventory.set(item.id, item);
  res.status(201).json(item);
});

// Get inventory
router.get("/", async (req: Request, res: Response) => {
  const category = req.query.category as string;
  const lowStock = req.query.low_stock === "true";
  
  let items = Array.from(inventory.values());
  
  if (category) items = items.filter(i => i.category === category);
  if (lowStock) items = items.filter(i => i.quantity <= i.reorder_point);
  
  res.json({ items });
});

// Get single item
router.get("/:id", async (req: Request, res: Response) => {
  const item = inventory.get(req.params.id);
  if (!item) {
    return res.status(404).json({ error: "Item not found" });
  }
  res.json(item);
});

// Update quantity
router.patch("/:id/quantity", async (req: Request, res: Response) => {
  const item = inventory.get(req.params.id);
  if (!item) {
    return res.status(404).json({ error: "Item not found" });
  }
  
  const adjustment = req.body.adjustment || 0;
  item.quantity = Math.max(0, item.quantity + adjustment);
  
  if (req.body.track_movement) {
    const movement: StockMovement = {
      id: uuidv4(),
      item_id: item.id,
      type: adjustment > 0 ? "in" : "out",
      quantity: Math.abs(adjustment),
      reason: req.body.reason || "Manual adjustment",
      timestamp: new Date()
    };
    movements.set(movement.id, movement);
  }
  
  inventory.set(item.id, item);
  res.json(item);
});

// Record stock movement
router.post("/movements", async (req: Request, res: Response) => {
  const movement: StockMovement = {
    id: uuidv4(),
    item_id: req.body.item_id,
    type: req.body.type,
    quantity: req.body.quantity,
    reason: req.body.reason,
    timestamp: new Date()
  };
  
  movements.set(movement.id, movement);
  
  // Update item quantity
  const item = inventory.get(req.body.item_id);
  if (item) {
    if (req.body.type === "in") {
      item.quantity += req.body.quantity;
      item.last_restocked = new Date();
    } else if (req.body.type === "out") {
      item.quantity = Math.max(0, item.quantity - req.body.quantity);
    }
    inventory.set(item.id, item);
  }
  
  res.status(201).json(movement);
});

// Get movements
router.get("/movements/:item_id", async (req: Request, res: Response) => {
  const itemMovements = Array.from(movements.values())
    .filter(m => m.item_id === req.params.item_id)
    .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  
  res.json({ movements: itemMovements });
});

// Low stock alerts
router.get("/alerts/low-stock", async (req: Request, res: Response) => {
  const lowStock = Array.from(inventory.values())
    .filter(i => i.quantity <= i.reorder_point);
  
  res.json({ alerts: lowStock });
});

// Par level management
router.get("/par-levels", async (req: Request, res: Response) => {
  const items = Array.from(inventory.values())
    .map(i => ({
      ...i,
      needs_restock: i.quantity <= i.reorder_point,
      days_of_stock: i.quantity / (i.par_level / 30) // Estimated
    }));
  
  res.json({ items });
});

// Supplier management
interface Supplier {
  id: string;
  name: string;
  contact: string;
  email: string;
  phone: string;
  categories: string[];
}

const suppliers: Map<string, Supplier> = new Map();

router.post("/suppliers", async (req: Request, res: Response) => {
  const supplier: Supplier = {
    id: uuidv4(),
    name: req.body.name,
    contact: req.body.contact,
    email: req.body.email,
    phone: req.body.phone,
    categories: req.body.categories || []
  };
  
  suppliers.set(supplier.id, supplier);
  res.status(201).json(supplier);
});

router.get("/suppliers", async (req: Request, res: Response) => {
  res.json({ suppliers: Array.from(suppliers.values()) });
});

// Analytics
router.get("/analytics", async (req: Request, res: Response) => {
  const items = Array.from(inventory.values());
  const totalValue = items.reduce((sum, i) => sum + (i.quantity * i.cost_per_unit), 0);
  const lowStock = items.filter(i => i.quantity <= i.reorder_point).length;
  
  res.json({
    total_items: items.length,
    total_value: totalValue,
    low_stock_count: lowStock,
    out_of_stock: items.filter(i => i.quantity === 0).length,
    categories: [...new Set(items.map(i => i.category))]
  });
});

export default router;