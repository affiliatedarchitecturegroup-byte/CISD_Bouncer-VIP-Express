import express, { Request, Response } from "express";

const router = express.Router();

// Cross-sell engine
router.get("/recommendations/:guest_id", async (req: Request, res: Response) => {
  res.json({ recommendations: [] });
});

export default router;