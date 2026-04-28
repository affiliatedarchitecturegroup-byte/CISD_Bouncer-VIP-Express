import express, { Request, Response } from "express";

const router = express.Router();

router.get("/status", async (req: Request, res: Response) => {
  res.json({ available: true });
});

export default router;