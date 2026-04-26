import express, { Request, Response } from "express";

const router = express.Router();

router.get("/routes", async (req: Request, res: Response) => {
  res.json({ shards: [] });
});

export default router;