import express, { Request, Response } from "express";

const router = express.Router();

router.get("/scan", async (req: Request, res: Response) => {
  res.json({ vulnerabilities: [], status: "clean" });
});

export default router;