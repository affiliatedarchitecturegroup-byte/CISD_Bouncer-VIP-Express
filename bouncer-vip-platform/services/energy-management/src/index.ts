import express, { Request, Response } from "express";

const router = express.Router();

// Energy management
router.get("/consumption", async (req: Request, res: Response) => {
  res.json({ current: 245, peak: 380, avg: 280, unit: "kW" });
});

export default router;