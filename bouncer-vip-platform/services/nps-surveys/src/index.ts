import express, { Request, Response } from "express";

const router = express.Router();

// NPS surveys
router.post("/send", async (req: Request, res: Response) => {
  res.json({ sent: true });
});

export default router;