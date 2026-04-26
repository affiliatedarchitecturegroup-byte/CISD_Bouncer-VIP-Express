import express, { Request, Response } from "express";

const router = express.Router();

router.get("/experiments", async (req: Request, res: Response) => {
  res.json({ experiments: [] });
});

export default router;