import express, { Request, Response } from "express";

const router = express.Router();

router.get("/deployments", async (req: Request, res: Response) => {
  res.json({ deployments: [] });
});

export default router;