import express, { Request, Response } from "express";

const router = express.Router();

router.get("/config", async (req: Request, res: Response) => {
  res.json({ cdn: "active" });
});

export default router;