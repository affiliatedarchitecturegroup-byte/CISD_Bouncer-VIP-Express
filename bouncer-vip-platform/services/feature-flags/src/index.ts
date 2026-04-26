import express, { Request, Response } from "express";

const router = express.Router();

router.get("/check", async (req: Request, res: Response) => {
  res.json({ enabled: true });
});

export default router;