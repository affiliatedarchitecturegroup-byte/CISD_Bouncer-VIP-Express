import express, { Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";

const router = express.Router();

// Maintenance types
router.get("/tasks", async (req: Request, res: Response) => {
  res.json({ tasks: [], total: 0 });
});

router.post("/tasks", async (req: Request, res: Response) => {
  res.json({ task_id: uuidv4(), ...req.body, status: "scheduled" });
});

router.put("/tasks/:id/status", async (req: Request, res: Response) => {
  res.json({ id: req.params.id, status: req.body.status });
});

export default router;