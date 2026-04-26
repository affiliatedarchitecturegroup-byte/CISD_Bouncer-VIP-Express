import express, { Request, Response } from "express";

const router = express.Router();

router.get("/bonuses", async (req: Request, res: Response) => {
  res.json({ bonuses: [] });
});

export default router;