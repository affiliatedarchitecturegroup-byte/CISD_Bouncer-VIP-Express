import express, { Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";

const router = express.Router();

// Queue types
interface QueueEntry {
  id: string;
  guest_id: string;
  guest_name: string;
  party_size: number;
  estimated_wait: number;
  actual_wait?: number;
  status: "waiting" | "called" | "seated" | "no_show";
  added_at: Date;
  called_at?: Date;
}

const queue: Map<string, QueueEntry> = new Map();

// Add to queue
router.post("/join", async (req: Request, res: Response) => {
  const entry: QueueEntry = {
    id: uuidv4(),
    guest_id: req.body.guest_id,
    guest_name: req.body.guest_name,
    party_size: req.body.party_size,
    estimated_wait: calculateWait(queue.size),
    status: "waiting",
    added_at: new Date()
  };
  queue.set(entry.id, entry);
  res.status(201).json(entry);
});

// Get queue position
router.get("/position/:guest_id", async (req: Request, res: Response) => {
  const entries = Array.from(queue.values())
    .filter(e => e.status === "waiting")
    .sort((a, b) => a.added_at.getTime() - b.added_at.getTime());
  
  const position = entries.findIndex(e => e.guest_id === req.params.guest_id);
  if (position === -1) {
    return res.json({ position: null, message: "Not in queue" });
  }
  res.json({ position: position + 1, estimated_wait: entries[position].estimated_wait });
});

// Call next guest
router.post("/call", async (req: Request, res: Response) => {
  const entries = Array.from(queue.values())
    .filter(e => e.status === "waiting")
    .sort((a, b) => a.added_at.getTime() - b.added_at.getTime());
  
  if (entries.length === 0) {
    return res.status(400).json({ error: "Queue empty" });
  }
  
  const next = entries[0];
  next.status = "called";
  next.called_at = new Date();
  next.actual_wait = Math.round((next.called_at.getTime() - next.added_at.getTime()) / 60000);
  queue.set(next.id, next);
  
  // Update wait times for everyone else
  for (const entry of entries.slice(1)) {
    entry.estimated_wait = calculateWait(
      entries.indexOf(entry)
    );
    queue.set(entry.id, entry);
  }
  
  res.json(next);
});

// Seat guest
router.post("/seat", async (req: Request, res: Response) => {
  const { queue_id } = req.body;
  const entry = queue.get(queue_id);
  if (!entry) return res.status(404).json({ error: "Entry not found" });
  
  entry.status = "seated";
  queue.set(entry.id, entry);
  res.json(entry);
});

// No-show
router.post("/no-show", async (req: Request, res: Response) => {
  const entry = queue.get(req.body.queue_id);
  if (!entry) return res.status(404).json({ error: "Entry not found" });
  
  entry.status = "no_show";
  queue.set(entry.id, entry);
  res.json(entry);
});

// Get queue
router.get("/", async (req: Request, res: Response) => {
  const entries = Array.from(queue.values())
    .filter(e => e.status === "waiting")
    .sort((a, b) => a.added_at.getTime() - b.added_at.getTime());
  res.json({ queue: entries, count: entries.length });
});

// Helper
function calculateWait(position: number): number {
  return Math.max(5, position * 10); // 10 min per person
}

export default router;