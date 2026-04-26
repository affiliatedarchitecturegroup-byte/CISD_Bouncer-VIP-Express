import express, { Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";

const router = express.Router();

// Incident types
router.get("/incidents", async (req: Request, res: Response) => {
  res.json({ incidents: [], total: 0 });
});

router.post("/incidents", async (req: Request, res: Response) => {
  res.json({ incident_id: uuidv4(), ...req.body, status: "open" });
});

router.put("/incidents/:id/status", async (req: Request, res: Response) => {
  res.json({ id: req.params.id, status: req.body.status });
});

export default router;