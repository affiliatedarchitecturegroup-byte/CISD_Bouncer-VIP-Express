import express, { Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";

const router = express.Router();

// Digital check-in types
interface CheckInSession {
  id: string;
  guest_id: string;
  qr_code: string;
  status: "pending" | "used" | "expired";
  scanned_at?: Date;
  created_at: Date;
}

const sessions: Map<string, CheckInSession> = new Map();

// Generate QR check-in
router.post("/generate-qr", async (req: Request, res: Response) => {
  const session: CheckInSession = {
    id: uuidv4(),
    guest_id: req.body.guest_id,
    qr_code: `QR_${uuidv4().slice(0, 8).toUpperCase()}`,
    status: "pending",
    created_at: new Date()
  };
  sessions.set(session.id, session);
  res.json({
    qr_code: session.qr_code,
    qr_url: `https://api.bouncervip.co.za/qr/${session.qr_code}`,
    expires: new Date(Date.now() + 3600000)
  });
});

// Verify QR check-in
router.post("/verify-qr", async (req: Request, res: Response) => {
  const { qr_code } = req.body;
  
  const session = Array.from(sessions.values())
    .find(s => s.qr_code === qr_code && s.status === "pending");
  
  if (!session) {
    return res.status(400).json({ valid: false, reason: "Invalid or used QR code" });
  }
  
  session.status = "used";
  session.scanned_at = new Date();
  sessions.set(session.id, session);
  
  res.json({
    valid: true,
    guest_id: session.guest_id,
    check_in_time: session.scanned_at
  });
});

// Facial check-in request
router.post("/facial/request", async (req: Request, res: Response) => {
  const { guest_id } = req.body;
  res.json({
    request_id: uuidv4(),
    guest_id,
    status: "ready",
    instructions: "Look at the camera"
  });
});

// Verify facial check-in
router.post("/facial/verify", async (req: Request, res: Response) => {
  const { guest_id, photo_data } = req.body;
  // Simplified - in production use proper facial recognition
  res.json({
    verified: true,
    guest_id,
    check_in_time: new Date().toISOString(),
    confidence: 0.95
  });
});

// Get check-in history
router.get("/history/:guest_id", async (req: Request, res: Response) => {
  const history = Array.from(sessions.values())
    .filter(s => s.guest_id === req.params.guest_id)
    .sort((a, b) => b.created_at.getTime() - a.created_at.getTime());
  res.json({ history });
});

export default router;