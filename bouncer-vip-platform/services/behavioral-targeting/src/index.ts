import express, { Request, Response } from "express";

const router = express.Router();

router.get("/segments", async (req: Request, res: Response) => {
  res.json({ segments: [] });
});

export default router;