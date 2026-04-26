import express, { Request, Response } from "express";

const router = express.Router();

// Churn prediction
router.get("/predict/:guest_id", async (req: Request, res: Response) => {
  res.json({ guest_id: req.params.guest_id, churn_risk: 0.15 });
});

export default router;