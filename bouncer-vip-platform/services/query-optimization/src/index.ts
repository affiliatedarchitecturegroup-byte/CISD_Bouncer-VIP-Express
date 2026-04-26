import express, { Request, Response } from "express";

const router = express.Router();

router.get("/optimize", async (req: Request, res: Response) => {
  res.json({ suggestions: [] });
});

export default router;