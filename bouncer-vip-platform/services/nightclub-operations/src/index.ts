import express, { Request, Response } from "express";

const router = express.Router();

// Nightclub operations types
interface FloorZone {
  id: string;
  name: string;
  capacity: number;
  current_occupancy: number;
  status: "open" | "closed" | "at_capacity";
}

const floorZones: Map<string, FloorZone> = new Map([
  ["main_floor", { id: "main_floor", name: "Main Floor", capacity: 300, current_occupancy: 0, status: "open" }],
  ["vip_area", { id: "vip_area", name: "VIP Area", capacity: 100, current_occupancy: 0, status: "open" }],
  ["dance_floor", { id: "dance_floor", name: "Dance Floor", capacity: 150, current_occupancy: 0, status: "open" }],
  ["lounge", { id: "lounge", name: "Lounge", capacity: 50, current_occupancy: 0, status: "open" }],
  ["outdoor", { id: "outdoor", name: "Outdoor", capacity: 80, current_occupancy: 0, status: "open" }],
]);

// Get all zones
router.get("/zones", async (req: Request, res: Response) => {
  res.json({ zones: Array.from(floorZones.values()) });
});

// Update occupancy
router.put("/zones/:id/occupancy", async (req: Request, res: Response) => {
  const zone = floorZones.get(req.params.id);
  if (!zone) return res.status(404).json({ error: "Zone not found" });
  
  zone.current_occupancy = req.body.occupancy;
  zone.status = zone.current_occupancy >= zone.capacity ? "at_capacity" : "open";
  floorZones.set(zone.id, zone);
  
  res.json(zone);
});

// Get total occupancy
router.get("/occupancy", async (req: Request, res: Response) => {
  const zones = Array.from(floorZones.values());
  const total = zones.reduce((sum, z) => sum + z.current_occupancy, 0);
  const capacity = zones.reduce((sum, z) => sum + z.capacity, 0);
  
  res.json({
    total_occupancy: total,
    total_capacity: capacity,
    utilization_percent: capacity > 0 ? (total / capacity) * 100 : 0
  });
});

export default router;