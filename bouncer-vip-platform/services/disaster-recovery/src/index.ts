import express, { Request, Response } from "express";

const router = express.Router();

router.get("/backup", async (req: Request, res: Response) => {
  res.json({ last_backup: new Date().toISOString(), status: "ok" });
});

export default router;