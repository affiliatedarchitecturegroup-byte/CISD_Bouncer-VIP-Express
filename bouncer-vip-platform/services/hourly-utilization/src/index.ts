import express, { Request, Response } from "express";

const router = express.Router();

// Hourly utilization
router.get("/", async (req: Request, res: Response) => {
  res.json({ utilization: { 21: 45, 22: 62, 23: 85, 00: 92, 01: 78, 02: 45 } });
});

export default router;