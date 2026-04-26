import express, { Request, Response } from "express";

const router = express.Router();

// Lifetime value prediction
router.get("/predict/:guest_id", async (req: Request, res: Response) => {
  res.json({ ltv: 15000, confidence: 0.82 });
});

export default router;