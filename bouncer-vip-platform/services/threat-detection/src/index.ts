import express, { Request, Response } from "express";

const router = express.Router();

router.get("/threats", async (req: Request, res: Response) => {
  res.json({ threats: [], status: "safe" });
});

export default router;