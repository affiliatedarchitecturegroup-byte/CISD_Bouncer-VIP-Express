import express, { Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";

const router = express.Router();

// Audit types
interface AuditLog {
  id: string;
  user_id: string;
  action: string;
  resource: string;
  timestamp: Date;
}

const logs: Map<string, AuditLog> = new Map();

// Create log
router.post("/logs", async (req: Request, res: Response) => {
  const log: AuditLog = {
    id: uuidv4(),
    user_id: req.body.user_id,
    action: req.body.action,
    resource: req.body.resource,
    timestamp: new Date()
  };
  logs.set(log.id, log);
  res.json(log);
});

// Query logs
router.get("/logs", async (req: Request, res: Response) => {
  res.json({ logs: Array.from(logs.values()) });
});

export default router;