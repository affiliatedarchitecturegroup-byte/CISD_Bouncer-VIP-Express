import express, { Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";

const router = express.Router();

// External API
router.get("/api-keys", async (req: Request, res: Response) => {
  res.json({ keys: [], total: 0 });
});

router.post("/api-keys", async (req: Request, res: Response) => {
  res.json({ key_id: uuidv4(), key: "sk_" + uuidv4().slice(0, 24), status: "active" });
});

router.post("/webhooks", async (req: Request, res: Response) => {
  res.json({ webhook_id: uuidv4(), ...req.body, status: "active" });
});

export default router;