import express, { Request, Response } from "express";

const router = express.Router();

// Marketing attribution
router.get("/model", async (req: Request, res: Response) => {
  res.json({ model: "last_touch", channels: [] });
});

export default router;