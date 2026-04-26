import express, { Request, Response } from "express";

const router = express.Router();

// Point redemption
router.post("/redeem", async (req: Request, res: Response) => {
  res.json({ success: true, points_used: req.body.points });
});

export default router;