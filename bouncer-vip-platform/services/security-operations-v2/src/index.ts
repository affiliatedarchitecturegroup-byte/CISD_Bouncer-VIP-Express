import express, { Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";

const router = express.Router();

interface Incident {
  id: string;
  type: string;
  severity: "low" | "medium" | "high" | "critical";
  description: string;
  location: string;
  reported_by: string;
  status: "open" | "in_progress" | "resolved" | "closed";
  created_at: Date;
  resolved_at?: Date;
}

const incidents: Map<string, Incident> = new Map();

// Report incident
router.post("/", async (req: Request, res: Response) => {
  const incident: Incident = {
    id: uuidv4(),
    type: req.body.type,
    severity: req.body.severity || "medium",
    description: req.body.description,
    location: req.body.location,
    reported_by: req.body.reported_by,
    status: "open",
    created_at: new Date()
  };
  incidents.set(incident.id, incident);
  res.status(201).json(incident);
});

// Get incidents
router.get("/", async (req: Request, res: Response) => {
  const status = req.query.status as string;
  let list = Array.from(incidents.values());
  if (status) list = list.filter(i => i.status === status);
  res.json({ incidents: list });
});

// Resolve incident
router.put("/:id/resolve", async (req: Request, res: Response) => {
  const incident = incidents.get(req.params.id);
  if (!incident) return res.status(404).json({ error: "Not found" });
  incident.status = "resolved";
  incident.resolved_at = new Date();
  incidents.set(incident.id, incident);
  res.json(incident);
});

// Analytics
router.get("/analytics", async (req: Request, res: Response) => {
  const list = Array.from(incidents.values());
  res.json({
    total: list.length,
    open: list.filter(i => i.status === "open").length,
    resolved: list.filter(i => i.status === "resolved").length,
    by_severity: {
      low: list.filter(i => i.severity === "low").length,
      medium: list.filter(i => i.severity === "medium").length,
      high: list.filter(i => i.severity === "high").length,
      critical: list.filter(i => i.severity === "critical").length
    }
  });
});

export default router;