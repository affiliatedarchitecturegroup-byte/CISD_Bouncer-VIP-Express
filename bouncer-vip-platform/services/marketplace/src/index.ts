import express, { Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";

const router = express.Router();

// Marketplace
router.get("/listings", async (req: Request, res: Response) => {
  res.json({ listings: [] });
});

export default router;