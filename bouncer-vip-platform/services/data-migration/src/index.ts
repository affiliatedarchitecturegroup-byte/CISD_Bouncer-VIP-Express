import express, { Request, Response } from "express";

const router = express.Router();

router.get("/jobs", async (req: Request, res: Response) => {
  res.json({ jobs: [] });
});

export default router;