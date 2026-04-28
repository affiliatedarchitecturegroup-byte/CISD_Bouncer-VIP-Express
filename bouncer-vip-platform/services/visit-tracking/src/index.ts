import express, { Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";

const router = express.Router();

// Visit tracking types
interface Visit {
  id: string;
  guest_id: string;
  venue_id: string;
  check_in_time: Date;
  check_out_time?: Date;
  duration_minutes?: number;
  table_id?: string;
  total_spent: number;
  drinks_ordered: number;
  notes?: string;
}

interface VisitAnalytics {
  total_visits: number;
  unique_guests: number;
  avg_visits_per_guest: number;
  avg_duration: number;
  avg_spent: number;
  peak_hours: number[];
  popular_days: string[];
}

// In-memory store
const visits: Map<string, Visit> = new Map();

// Check-in guest
router.post("/checkin", async (req: Request, res: Response) => {
  const visit: Visit = {
    id: uuidv4(),
    guest_id: req.body.guest_id,
    venue_id: req.body.venue_id || "main",
    check_in_time: new Date(),
    table_id: req.body.table_id,
    total_spent: 0,
    drinks_ordered: 0,
    notes: req.body.notes
  };
  
  visits.set(visit.id, visit);
  res.status(201).json(visit);
});

// Check-out guest
router.post("/:visit_id/checkout", async (req: Request, res: Response) => {
  const visit = visits.get(req.params.visit_id);
  if (!visit) {
    return res.status(404).json({ error: "Visit not found" });
  }
  
  visit.check_out_time = new Date();
  visit.duration_minutes = Math.round(
    (visit.check_out_time.getTime() - visit.check_in_time.getTime()) / 60000
  );
  
  res.json(visit);
});

// Get visit by ID
router.get("/:id", async (req: Request, res: Response) => {
  const visit = visits.get(req.params.id);
  if (!visit) {
    return res.status(404).json({ error: "Visit not found" });
  }
  res.json(visit);
});

// Get guest visits
router.get("/guest/:guest_id", async (req: Request, res: Response) => {
  const guestVisits = Array.from(visits.values())
    .filter(v => v.guest_id === req.params.guest_id)
    .sort((a, b) => b.check_in_time.getTime() - a.check_in_time.getTime());
  
  res.json({ visits: guestVisits });
});

// Analytics endpoint
router.get("/analytics", async (req: Request, res: Response) => {
  const visitArray = Array.from(visits.values());
  const guests = new Set(visitArray.map(v => v.guest_id));
  
  const analytics: VisitAnalytics = {
    total_visits: visitArray.length,
    unique_guests: guests.size,
    avg_visits_per_guest: visitArray.length / guests.size || 0,
    avg_duration: visitArray.reduce((s, v) => s + (v.duration_minutes || 0), 0) / visitArray.length || 0,
    avg_spent: visitArray.reduce((s, v) => s + v.total_spent, 0) / visitArray.length || 0,
    peak_hours: [21, 22, 23, 0],
    popular_days: ["Friday", "Saturday", "Sunday"]
  };
  
  res.json(analytics);
});

export default router;