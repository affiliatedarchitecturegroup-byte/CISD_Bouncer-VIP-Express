import express, { Request, Response } from "express";

const router = express.Router();

router.get("/campaigns", async (req: Request, res: Response) => {
  res.json({ campaigns: [] });
});

export default router;