import express, { Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";

const router = express.Router();

// Dynamic pricing
router.get("/calculate", async (req: Request, res: Response) => {
  res.json({ base_price: 200, dynamic_price: 250, factor: 1.25 });
});

export default router;