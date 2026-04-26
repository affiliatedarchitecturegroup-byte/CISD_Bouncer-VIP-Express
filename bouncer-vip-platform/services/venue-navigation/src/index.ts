import express, { Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";

const router = express.Router();

// Venue navigation types
interface PointOfInterest {
  id: string;
  name: string;
  type: "bar" | "toilet" | "vip" | "dance_floor" | "exit" | "info";
  floor: number;
  coordinates: { x: number; y: number };
  accessible: boolean;
}

const pois: PointOfInterest[] = [
  { id: "poi1", name: "Main Bar", type: "bar", floor: 1, coordinates: { x: 50, y: 50 }, accessible: true },
  { id: "poi2", name: "VIP Lounge", type: "vip", floor: 1, coordinates: { x: 80, y: 20 }, accessible: true },
  { id: "poi3", name: "Dance Floor", type: "dance_floor", floor: 1, coordinates: { x: 30, y: 70 }, accessible: true },
  { id: "poi4", name: "Main Exit", type: "exit", floor: 1, coordinates: { x: 10, y: 10 }, accessible: true },
  { id: "poi5", name: "Restrooms", type: "toilet", floor: 1, coordinates: { x: 90, y: 80 }, accessible: true },
];

// Get venue map
router.get("/map", async (req: Request, res: Response) => {
  res.json({
    venue: "Bouncer VIP Club",
    floors: 2,
    pois
  });
});

// Get directions
router.get("/directions", async (req: Request, res: Response) => {
  const { from, to } = req.query;
  res.json({
    from,
    to,
    path: [{ x: 10, y: 10 }, { x: 30, y: 30 }, { x: 50, y: 50 }],
    estimated_time: "2 min"
  });
});

// Get POI
router.get("/poi/:id", async (req: Request, res: Response) => {
  const poi = pois.find(p => p.id === req.params.id);
  if (!poi) return res.status(404).json({ error: "POI not found" });
  res.json(poi);
});

// Get accessible routes
router.get("/accessible", async (req: Request, res: Response) => {
  res.json({
    pois: pois.filter(p => p.accessible)
  });
});

export default router;