import express, { Request, Response } from "express";

const router = express.Router();

router.post("/process", async (req: Request, res: Response) => {
  res.json({ processed: true });
});

export default router;