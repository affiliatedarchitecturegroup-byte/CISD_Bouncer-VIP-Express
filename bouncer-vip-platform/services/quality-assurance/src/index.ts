import express, { Request, Response } from "express";

const router = express.Router();

router.get("/tests", async (req: Request, res: Response) => {
  res.json({ tests: [] });
});

export default router;