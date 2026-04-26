import express, { Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";

const router = express.Router();

// Talent acquisition
router.get("/jobs", async (req: Request, res: Response) => {
  res.json({
    jobs: [
      { id: "j1", title: "Bartender", department: "F&B", status: "open" },
      { id: "j2", title: "Security", department: "Ops", status: "open" }
    ]
  });
});

router.post("/jobs", async (req: Request, res: Response) => {
  res.json({ job_id: uuidv4(), ...req.body, status: "open" });
});

router.get("/candidates", async (req: Request, res: Response) => {
  res.json({ candidates: [], total: 0 });
});

router.post("/candidates", async (req: Request, res: Response) => {
  res.json({ candidate_id: uuidv4(), ...req.body, status: "applied" });
});

export default router;