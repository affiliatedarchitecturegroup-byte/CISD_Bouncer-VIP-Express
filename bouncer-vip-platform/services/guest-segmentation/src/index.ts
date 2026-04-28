import express, { Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";

const router = express.Router();

// Guest segmentation types
interface GuestSegment {
  id: string;
  name: string;
  description: string;
  criteria: SegmentCriteria;
  member_count: number;
  created_at: Date;
}

interface SegmentCriteria {
  minimum_visits?: number;
  maximum_visits?: number;
  minimum_spent?: number;
  maximum_spent?: number;
  minimum_ltv?: number;
  maximum_ltv?: number;
  tiers?: string[];
  tags?: string[];
  status?: string[];
  date_joined_after?: string;
  date_joined_before?: string;
}

// Segment storage
const segments: Map<string, GuestSegment> = new Map();

// Default segments
const defaultSegments: GuestSegment[] = [
  {
    id: uuidv4(),
    name: "VIP Guests",
    description: "High-value guests with premium tier status",
    criteria: { tiers: ["platinum", "diamond"], minimum_ltv: 50000 },
    member_count: 0,
    created_at: new Date()
  },
  {
    id: uuidv4(),
    name: "Loyal Customers",
    description: "Frequent visitors with 20+ visits",
    criteria: { minimum_visits: 20 },
    member_count: 0,
    created_at: new Date()
  },
  {
    id: uuidv4(),
    name: "At Risk",
    description: "Previous active guests with no visits in 60 days",
    criteria: { status: ["active"] },
    member_count: 0,
    created_at: new Date()
  },
  {
    id: uuidv4(),
    name: "New This Month",
    description: "Guests who joined this month",
    criteria: { status: ["active"] },
    member_count: 0,
    created_at: new Date()
  }
];

defaultSegments.forEach(s => segments.set(s.id, s));

// Get all segments
router.get("/", async (req: Request, res: Response) => {
  res.json({ segments: Array.from(segments.values()) });
});

// Get segment by ID
router.get("/:id", async (req: Request, res: Response) => {
  const segment = segments.get(req.params.id);
  if (!segment) {
    return res.status(404).json({ error: "Segment not found" });
  }
  res.json(segment);
});

// Create segment
router.post("/", async (req: Request, res: Response) => {
  const segment: GuestSegment = {
    id: uuidv4(),
    name: req.body.name,
    description: req.body.description,
    criteria: req.body.criteria,
    member_count: 0,
    created_at: new Date()
  };
  
  segments.set(segment.id, segment);
  res.status(201).json(segment);
});

// Update segment
router.put("/:id", async (req: Request, res: Response) => {
  const segment = segments.get(req.params.id);
  if (!segment) {
    return res.status(404).json({ error: "Segment not found" });
  }
  
  Object.assign(segment, req.body);
  res.json(segment);
});

// Delete segment
router.delete("/:id", async (req: Request, res: Response) => {
  if (!segments.has(req.params.id)) {
    return res.status(404).json({ error: "Segment not found" });
  }
  segments.delete(req.params.id);
  res.status(204).send();
});

// Segment analytics
router.get("/analytics/overview", async (req: Request, res: Response) => {
  const segmentArray = Array.from(segments.values());
  
  res.json({
    total_segments: segmentArray.length,
    segments: segmentArray.map(s => ({
      id: s.id,
      name: s.name,
      member_count: s.member_count
    }))
  });
});

export default router;