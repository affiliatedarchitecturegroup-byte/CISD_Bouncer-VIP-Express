import express, { Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";

const router = express.Router();

// Event types
interface Event {
  id: string;
  name: string;
  description: string;
  date: Date;
  venue: string;
  capacity: number;
  ticket_price: number;
  status: "draft" | "published" | "cancelled" | "completed";
  tickets_sold: number;
}

const events: Map<string, Event> = new Map();

// Create event
router.post("/", async (req: Request, res: Response) => {
  const event: Event = {
    id: uuidv4(),
    name: req.body.name,
    description: req.body.description,
    date: new Date(req.body.date),
    venue: req.body.venue,
    capacity: req.body.capacity || 500,
    ticket_price: req.body.ticket_price || 0,
    status: "draft",
    tickets_sold: 0
  };
  events.set(event.id, event);
  res.status(201).json(event);
});

// Get events
router.get("/", async (req: Request, res: Response) => {
  const list = Array.from(events.values())
    .filter(e => e.status === "published");
  res.json({ events: list });
});

// Publish event
router.put("/:id/publish", async (req: Request, res: Response) => {
  const event = events.get(req.params.id);
  if (!event) return res.status(404).json({ error: "Event not found" });
  event.status = "published";
  events.set(event.id, event);
  res.json(event);
});

// Cancel event
router.put("/:id/cancel", async (req: Request, res: Response) => {
  const event = events.get(req.params.id);
  if (!event) return res.status(404).json({ error: "Event not found" });
  event.status = "cancelled";
  events.set(event.id, event);
  res.json(event);
});

// Tickets endpoint
router.post("/:id/tickets", async (req: Request, res: Response) => {
  const event = events.get(req.params.id);
  if (!event) return res.status(404).json({ error: "Event not found" });
  
  if (event.tickets_sold >= event.capacity) {
    return res.status(400).json({ error: "Event sold out" });
  }
  
  event.tickets_sold++;
  events.set(event.id, event);
  res.json({ ticket_id: uuidv4(), event_id: event.id, status: "confirmed" });
});

export default router;