import express, { Request, Response } from "express";

const router = express.Router();

router.post("/process", async (req: Request, res: Response) => {
  res.json({ response: "processed" });
});

export default router;