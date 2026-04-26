import express, { Request, Response } from "express";

const router = express.Router();

router.get("/connect", async (req: Request, res: Response) => {
  res.json({ connected: true });
});

export default router;