import express, { Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";

const router = express.Router();

// Lead types
interface Lead {
  id: string;
  name: string;
  email: string;
  source: string;
  status: "new" | "contacted" | "qualified" | "converted";
  created_at: Date;
}

// Create lead
router.post("/leads", async (req: Request, res: Response) => {
  const lead: Lead = {
    id: uuidv4(),
    name: req.body.name,
    email: req.body.email,
    source: req.body.source || "website",
    status: "new",
    created_at: new Date()
  };
  res.json(lead);
});

// Get leads
router.get("/leads", async (req: Request, res: Response) => {
  const source = req.query.source as string;
  res.json({ leads: [], total: 0 });
});

// Track conversion
router.post("/:id/convert", async (req: Request, res: Response) => {
  res.json({ converted: true, guest_id: uuidv4() });
});

export default router;