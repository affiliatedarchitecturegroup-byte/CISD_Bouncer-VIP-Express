import express, { Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";

const router = express.Router();

// Ticket types
interface Ticket {
  id: string;
  guest_id: string;
  subject: string;
  description: string;
  priority: "low" | "medium" | "high";
  status: "open" | "in_progress" | "resolved";
}

// Create ticket
router.post("/tickets", async (req: Request, res: Response) => {
  const ticket: Ticket = {
    id: uuidv4(),
    guest_id: req.body.guest_id,
    subject: req.body.subject,
    description: req.body.description,
    priority: req.body.priority || "medium",
    status: "open"
  };
  res.json(ticket);
});

// Get tickets
router.get("/tickets", async (req: Request, res: Response) => {
  res.json({ tickets: [] });
});

// Update ticket
router.put("/tickets/:id", async (req: Request, res: Response) => {
  res.json({ id: req.params.id, ...req.body });
});

// Knowledge base
router.get("/knowledge-base", async (req: Request, res: Response) => {
  res.json({
    articles: [
      { id: "kb1", title: "VIP Tiers", category: "membership" },
      { id: "kb2", title: "Events Calendar", category: "events" }
    ]
  });
});

export default router;