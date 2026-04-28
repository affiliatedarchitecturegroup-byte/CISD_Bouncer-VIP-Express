import express, { Request, Response } from "express";

const router = express.Router();

router.get("/streams", async (req: Request, res: Response) => {
  res.json({ streams: [] });
});

export default router;