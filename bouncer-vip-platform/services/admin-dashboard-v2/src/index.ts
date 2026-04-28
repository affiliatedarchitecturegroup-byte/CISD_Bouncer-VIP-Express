import express, { Request, Response } from "express";

const router = express.Router();

router.get("/analytics", async (req: Request, res: Response) => {
  res.json({ analytics: {} });
});

export default router;