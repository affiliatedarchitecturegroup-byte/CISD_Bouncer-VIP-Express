import express, { Request, Response } from "express";

const router = express.Router();

// Offer personalization
router.get("/recommendations/:guest_id", async (req: Request, res: Response) => {
  res.json({ offers: [] });
});

export default router;