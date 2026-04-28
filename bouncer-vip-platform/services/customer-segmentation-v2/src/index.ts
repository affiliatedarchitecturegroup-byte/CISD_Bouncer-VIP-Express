import express, { Request, Response } from "express";

const router = express.Router();

// Customer segmentation V2
router.get("/segments", async (req: Request, res: Response) => {
  res.json({ segments: [] });
});

export default router;