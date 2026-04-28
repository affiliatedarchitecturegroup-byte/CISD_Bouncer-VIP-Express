import express, { Request, Response } from "express";

const router = express.Router();

router.get("/functions", async (req: Request, res: Response) => {
  res.json({ functions: [] });
});

export default router;