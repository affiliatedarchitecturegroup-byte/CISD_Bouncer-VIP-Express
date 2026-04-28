import express, { Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";

const router = express.Router();

// Menu types
interface MenuItem {
  id: string;
  name: string;
  description: string;
  price: number;
  category: string;
  dietary: string[];
  allergens: string[];
  available: boolean;
  image_url?: string;
}

const menuItems: Map<string, MenuItem> = new Map([
  ["m1", { id: "m1", name: "Premium Whiskey", description: "12 Year Single Malt", price: 150, category: "Spirits", dietary: [], allergens: [], available: true }],
  ["m2", { id: "m2", name: "Champagne", description: "Premium Brut", price: 200, category: "Wine", dietary: [], allergens: [], available: true }],
  ["m3", { id: "m3", name: "Martini", description: "Classic or Fruit", price: 120, category: "Cocktails", dietary: [], allergens: [], available: true }],
  ["m4", { id: "m4", name: "Crown Tower", description: "Premium bottle service", price: 2500, category: "Bottle Service", dietary: [], allergens: [], available: true }],
]);

// Get menu
router.get("/", async (req: Request, res: Response) => {
  const category = req.query.category as string;
  const dietary = req.query.dietary as string;
  
  let items = Array.from(menuItems.values()).filter(i => i.available);
  
  if (category) items = items.filter(i => i.category === category);
  if (dietary) items = items.filter(i => i.dietary.includes(dietary));
  
  // Group by category
  const byCategory: Record<string, MenuItem[]> = {};
  for (const item of items) {
    if (!byCategory[item.category]) byCategory[item.category] = [];
    byCategory[item.category].push(item);
  }
  
  res.json({ menu: byCategory });
});

// Get single item
router.get("/:id", async (req: Request, res: Response) => {
  const item = menuItems.get(req.params.id);
  if (!item) return res.status(404).json({ error: "Item not found" });
  res.json(item);
});

// Filter by allergens
router.post("/filter", async (req: Request, res: Response) => {
  const { exclude_allergens } = req.body;
  
  const items = Array.from(menuItems.values())
    .filter(i => i.available && !i.allergens.some(a => exclude_allergens.includes(a)));
  
  res.json({ items });
});

// Add menu item (admin)
router.post("/", async (req: Request, res: Response) => {
  const item: MenuItem = {
    id: uuidv4(),
    name: req.body.name,
    description: req.body.description,
    price: req.body.price,
    category: req.body.category,
    dietary: req.body.dietary || [],
    allergens: req.body.allergens || [],
    available: true,
    image_url: req.body.image_url
  };
  menuItems.set(item.id, item);
  res.status(201).json(item);
});

// Update availability
router.put("/:id/availability", async (req: Request, res: Response) => {
  const item = menuItems.get(req.params.id);
  if (!item) return res.status(404).json({ error: "Item not found" });
  
  item.available = req.body.available;
  menuItems.set(item.id, item);
  res.json(item);
});

export default router;