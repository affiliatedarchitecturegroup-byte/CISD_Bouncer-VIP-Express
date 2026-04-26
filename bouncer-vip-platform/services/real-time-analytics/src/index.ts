import express, { Request, Response } from "express";

const router = express.Router();

router.get("/dashboards", async (req: Request, res: Response) => {
  res.json({ dashboards: [] });
});

export default router;