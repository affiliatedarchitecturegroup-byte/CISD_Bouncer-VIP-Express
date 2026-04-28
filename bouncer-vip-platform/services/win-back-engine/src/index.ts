import express, { Request, Response } from "express";

const router = express.Router();

// Win-back engine
router.get("/at-risk", async (req: Request, res: Response) => {
  res.json({ guests: [] });
});

export default router;