import express, { Request, Response } from "express";

const router = express.Router();

router.get("/features", async (req: Request, res: Response) => {
  res.json({ features: [] });
});

export default router;