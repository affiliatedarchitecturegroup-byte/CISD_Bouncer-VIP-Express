import express, { Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";

const router = express.Router();

// Message types
interface SMSMessage {
  id: string;
  to: string;
  body: string;
  status: "queued" | "sent" | "delivered" | "failed";
  sent_at?: Date;
}

interface EmailMessage {
  id: string;
  to: string;
  subject: string;
  body: string;
  status: "queued" | "sent" | "delivered" | "failed";
  sent_at?: Date;
}

interface PushNotification {
  id: string;
  user_id: string;
  title: string;
  body: string;
  data?: Record<string, any>;
  status: "queued" | "sent" | "delivered";
}

const smsQueue: Map<string, SMSMessage> = new Map();
const emailQueue: Map<string, EmailMessage> = new Map();
const pushQueue: Map<string, PushNotification> = new Map();

// Send SMS
router.post("/sms", async (req: Request, res: Response) => {
  const message: SMSMessage = {
    id: uuidv4(),
    to: req.body.to,
    body: req.body.body,
    status: "queued"
  };
  
  // Simulate sending
  message.status = "sent";
  message.sent_at = new Date();
  
  smsQueue.set(message.id, message);
  res.status(201).json(message);
});

// Send email
router.post("/email", async (req: Request, res: Response) => {
  const message: EmailMessage = {
    id: uuidv4(),
    to: req.body.to,
    subject: req.body.subject,
    body: req.body.body,
    status: "queued"
  };
  
  message.status = "sent";
  message.sent_at = new Date();
  
  emailQueue.set(message.id, message);
  res.status(201).json(message);
});

// Send push notification
router.post("/push", async (req: Request, res: Response) => {
  const notification: PushNotification = {
    id: uuidv4(),
    user_id: req.body.user_id,
    title: req.body.title,
    body: req.body.body,
    data: req.body.data,
    status: "queued"
  };
  
  notification.status = "sent";
  pushQueue.set(notification.id, notification);
  res.status(201).json(notification);
});

// Get message logs
router.get("/logs", async (req: Request, res: Response) => {
  res.json({
    sms: Array.from(smsQueue.values()),
    emails: Array.from(emailQueue.values()),
    push: Array.from(pushQueue.values())
  });
});

export default router;