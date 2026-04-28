import express, { Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";

const router = express.Router();

// Private event types
interface PrivateEvent {
  id: string;
  guest_id: string;
  name: string;
  date: string;
  guest_list: string[];
  capacity: number;
  status: "inquiry" | "confirmed" | "completed";
}

const events: Map<string, PrivateEvent> = new Map();

// Create inquiry
router.post("/inquiry", async (req: Request, res: Response) => {
  const event: PrivateEvent = {
    id: uuidv4(),
    guest_id: req.body.guest_id,
    name: req.body.name,
    date: req.body.date,
    guest_list: [],
    capacity: req.body.capacity,
    status: "inquiry"
  };
  events.set(event.id, event);
  res.json(event);
});

// Get my events
router.get("/:guest_id", async (req: Request, res: Response) => {
  const list = Array.from(events.values())
    .filter(e => e.guest_id === req.params.guest_id);
  res.json({ events: list });
});

// Add to guest list
router.post("/:event_id/guestlist", async (req: Request, res: Response) => {
  const event = events.get(req.params.event_id);
  if (!event) return res.status(404).json({ error: "Event not found" });
  
  event.guest_list.push(req.body.guest_id);
  events.set(event.id, event);
  res.json(event);
});

// Confirm event
router.put("/:event_id/confirm", async (req: Request, res: Response) => {
  const event = events.get(req.params.event_id);
  if (!event) return res.status(404).json({ error: "Event not found" });
  
  event.status = "confirmed";
  events.set(event.id, event);
  res.json(event);
});

export default router;