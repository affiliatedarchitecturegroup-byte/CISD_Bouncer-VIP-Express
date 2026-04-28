import express, { Request, Response } from "express";

const router = express.Router();

// Inventory forecast
router.get("/predict", async (req: Request, res: Response) => {
  res.json({ predictions: [] });
});

export default router;