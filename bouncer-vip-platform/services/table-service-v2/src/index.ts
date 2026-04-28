import express, { Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";

const router = express.Router();

// Table types
interface Table {
  id: string;
  name: string;
  capacity: number;
  min_spending: number;
  location: string;
  status: "available" | "reserved" | "occupied" | "maintenance";
  price: number;
}

interface TableReservation {
  id: string;
  table_id: string;
  guest_id: string;
  date: string;
  time: string;
  party_size: number;
  status: "pending" | "confirmed" | "seated" | "completed" | "cancelled";
  special_requests?: string;
  created_at: Date;
}

// Storage
const tables: Map<string, Table> = new Map([
  ["t1", { id: "t1", name: "Table 1", capacity: 8, min_spending: 2000, location: "floor_a", status: "available", price: 500 }],
  ["t2", { id: "t2", name: "Table 2", capacity: 10, min_spending: 3000, location: "floor_a", status: "available", price: 750 }],
  ["t3", { id: "t3", name: "VIP Booth", capacity: 12, min_spending: 5000, location: "vip_area", status: "available", price: 1500 }],
  ["t4", { id: "t4", name: "Table 4", capacity: 6, min_spending: 1500, location: "floor_b", status: "available", price: 350 }],
  ["t5", { id: "t5", name: "Table 5", capacity: 6, min_spending: 1500, location: "floor_b", status: "available", price: 350 }],
]);

const reservations: Map<string, TableReservation> = new Map();

// Get all tables
router.get("/", async (req: Request, res: Response) => {
  const availableOnly = req.query.available === "true";
  const date = req.query.date as string;
  
  let tableArray = Array.from(tables.values());
  
  if (availableOnly) {
    tableArray = tableArray.filter(t => t.status === "available");
  }
  
  // Check availability for date
  if (date) {
    for (const [id, resv] of reservations) {
      if (resv.date === date && resv.status !== "cancelled") {
        const table = tables.get(resv.table_id);
        if (table) table.status = "reserved";
      }
    }
  }
  
  res.json({ tables: tableArray });
});

// Get single table
router.get("/:id", async (req: Request, res: Response) => {
  const table = tables.get(req.params.id);
  if (!table) {
    return res.status(404).json({ error: "Table not found" });
  }
  res.json(table);
});

// Create reservation
router.post("/reserve", async (req: Request, res: Response) => {
  const { table_id, guest_id, date, time, party_size, special_requests } = req.body;
  
  const table = tables.get(table_id);
  if (!table) {
    return res.status(404).json({ error: "Table not found" });
  }
  
  if (table.status !== "available") {
    return res.status(400).json({ error: "Table not available" });
  }
  
  if (party_size > table.capacity) {
    return res.status(400).json({ error: "Party size exceeds table capacity" });
  }
  
  const reservation: TableReservation = {
    id: uuidv4(),
    table_id,
    guest_id,
    date,
    time,
    party_size,
    status: "pending",
    special_requests,
    created_at: new Date()
  };
  
  reservations.set(reservation.id, reservation);
  tables.set(table_id, { ...table, status: "reserved" });
  
  res.status(201).json(reservation);
});

// Confirm reservation
router.put("/reserve/:id/confirm", async (req: Request, res: Response) => {
  const resv = reservations.get(req.params.id);
  if (!resv) {
    return res.status(404).json({ error: "Reservation not found" });
  }
  
  resv.status = "confirmed";
  reservations.set(req.params.id, resv);
  res.json(resv);
});

// Check-in (seat party)
router.put("/reserve/:id/seat", async (req: Request, res: Response) => {
  const resv = reservations.get(req.params.id);
  if (!resv) {
    return res.status(404).json({ error: "Reservation not found" });
  }
  
  resv.status = "seated";
  const table = tables.get(resv.table_id);
  if (table) {
    table.status = "occupied";
    tables.set(resv.table_id, table);
  }
  
  reservations.set(req.params.id, resv);
  res.json(resv);
});

// Cancel reservation
router.put("/reserve/:id/cancel", async (req: Request, res: Response) => {
  const resv = reservations.get(req.params.id);
  if (!resv) {
    return res.status(404).json({ error: "Reservation not found" });
  }
  
  resv.status = "cancelled";
  const table = tables.get(resv.table_id);
  if (table) {
    table.status = "available";
    tables.set(resv.table_id, table);
  }
  
  reservations.set(req.params.id, resv);
  res.json(resv);
});

// Get reservations
router.get("/reservations", async (req: Request, res: Response) => {
  const date = req.query.date as string;
  let resvArray = Array.from(reservations.values());
  
  if (date) {
    resvArray = resvArray.filter(r => r.date === date);
  }
  
  res.json({ reservations: resvArray });
});

// Get table availability
router.get("/availability", async (req: Request, res: Response) => {
  const date = req.query.date as string;
  const time = req.query.time as string;
  const partySize = parseInt(req.query.party_size as string) || 2;
  
  const available = Array.from(tables.values())
    .filter(t => t.status === "available" && t.capacity >= partySize);
  
  res.json({ 
    available: available.map(t => ({
      id: t.id,
      name: t.name,
      capacity: t.capacity,
      price: t.price,
      min_spending: t.min_spending,
      location: t.location
    })),
    count: available.length
  });
});

// Calculate dynamic pricing
router.get("/pricing/dynamic", async (req: Request, res: Response) => {
  const date = req.query.date as string;
  const dayOfWeek = new Date(date).getDay();
  
  // Pricing factors
  let multiplier = 1.0;
  if (dayOfWeek === 5 || dayOfWeek === 6) multiplier = 1.5; // Fri, Sat
  if (dayOfWeek === 0) multiplier = 1.25; // Sunday
  
  const tableArray = Array.from(tables.values());
  const dynamicPricing = tableArray.map(t => ({
    table_id: t.id,
    name: t.name,
    base_price: t.price,
    dynamic_price: Math.round(t.price * multiplier),
    multiplier
  }));
  
  res.json({ pricing: dynamicPricing });
});

// Waitlist
const waitlist: { guest_id: string; party_size: number; created_at: Date }[] = [];

router.post("/waitlist", async (req: Request, res: Response) => {
  waitlist.push({
    guest_id: req.body.guest_id,
    party_size: req.body.party_size,
    created_at: new Date()
  });
  res.json({ position: waitlist.length, message: "Added to waitlist" });
});

router.get("/waitlist", async (req: Request, res: Response) => {
  res.json({ waitlist });
});

export default router;