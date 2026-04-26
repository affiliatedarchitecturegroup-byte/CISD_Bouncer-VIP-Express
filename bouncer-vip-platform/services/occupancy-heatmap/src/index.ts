import express, { Request, Response } from "express";

const router = express.Router();

// Occupancy heatmap
router.get("/", async (req: Request, res: Response) => {
  res.json({ zones: [] });
});

export default router;