import express, { Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";

const router = express.Router();

// Access types
interface AccessCredential {
  id: string;
  guest_id: string;
  credential_type: "rfid" | "nfc" | "biometric" | "qr";
  credential_value: string;
  status: "active" | "suspended" | "expired";
  valid_until?: Date;
  created_at: Date;
}

interface AccessLog {
  id: string;
  guest_id: string;
  credential_id: string;
  entry_point: string;
  timestamp: Date;
  result: "granted" | "denied";
  reason?: string;
}

// Storage
const credentials: Map<string, AccessCredential> = new Map();
const accessLogs: Map<string, AccessLog> = new Map();

// Issue credential
router.post("/credentials", async (req: Request, res: Response) => {
  const cred: AccessCredential = {
    id: uuidv4(),
    guest_id: req.body.guest_id,
    credential_type: req.body.credential_type || "rfid",
    credential_value: uuidv4().slice(0, 8).toUpperCase(),
    status: "active",
    valid_until: req.body.valid_until,
    created_at: new Date()
  };
  
  credentials.set(cred.id, cred);
  res.status(201).json(cred);
});

// Verify access
router.post("/verify", async (req: Request, res: Response) => {
  const { credential_value, guest_id, entry_point } = req.body;
  
  const cred = Array.from(credentials.values())
    .find(c => c.credential_value === credential_value && c.status === "active");
  
  let result: "granted" | "denied" = "denied";
  let reason = "Invalid credential";
  
  if (cred) {
    if (cred.valid_until && new Date(cred.valid_until) < new Date()) {
      result = "denied";
      reason = "Credential expired";
    } else {
      result = "granted";
      reason = "Access granted";
    }
  }
  
  const log: AccessLog = {
    id: uuidv4(),
    guest_id: guest_id || cred?.guest_id,
    credential_id: cred?.id,
    entry_point,
    timestamp: new Date(),
    result,
    reason
  };
  accessLogs.set(log.id, log);
  
  res.json({ result, reason, log_id: log.id });
});

// Get credentials
router.get("/credentials/:guest_id", async (req: Request, res: Response) => {
  const creds = Array.from(credentials.values())
    .filter(c => c.guest_id === req.params.guest_id);
  res.json({ credentials: creds });
});

// Access logs
router.get("/logs", async (req: Request, res: Response) => {
  const logs = Array.from(accessLogs.values())
    .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
    .slice(0, 100);
  res.json({ logs });
});

// Analytics
router.get("/analytics", async (req: Request, res: Response) => {
  const logs = Array.from(accessLogs.values());
  const granted = logs.filter(l => l.result === "granted").length;
  const denied = logs.filter(l => l.result === "denied").length;
  
  res.json({ 
    total: logs.length,
    granted,
    denied,
    success_rate: logs.length > 0 ? granted / logs.length : 0
  });
});

export default router;