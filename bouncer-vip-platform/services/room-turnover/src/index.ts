import express, { Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";

const router = express.Router();

// Room turnover
router.post("/check-out", async (req: Request, res: Response) => {
  res.json({ completed: true, time_taken: 15 });
});

router.get("/status", async (req: Request, res: Response) => {
  res.json({ rooms: { available: 12, cleaning: 3, occupied: 8 } });
});

export default router;