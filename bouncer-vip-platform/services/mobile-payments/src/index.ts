import express, { Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";

const router = express.Router();

// Mobile payment types
interface PaymentMethod {
  id: string;
  guest_id: string;
  type: "card" | "bank" | "mobile_money";
  last4: string;
  is_default: boolean;
}

interface MobilePayment {
  id: string;
  guest_id: string;
  amount: number;
  method_id: string;
  status: "pending" | "completed" | "failed";
  created_at: Date;
}

const paymentMethods: Map<string, PaymentMethod> = new Map();
const payments: Map<string, MobilePayment> = new Map();

// Add payment method
router.post("/methods", async (req: Request, res: Response) => {
  const method: PaymentMethod = {
    id: uuidv4(),
    guest_id: req.body.guest_id,
    type: req.body.type || "card",
    last4: req.body.last4 || "4242",
    is_default: req.body.is_default || false
  };
  paymentMethods.set(method.id, method);
  res.json(method);
});

// Get payment methods
router.get("/methods/:guest_id", async (req: Request, res: Response) => {
  const methods = Array.from(paymentMethods.values())
    .filter(m => m.guest_id === req.params.guest_id);
  res.json({ methods });
});

// Process mobile payment
router.post("/pay", async (req: Request, res: Response) => {
  const payment: MobilePayment = {
    id: uuidv4(),
    guest_id: req.body.guest_id,
    amount: req.body.amount,
    method_id: req.body.method_id,
    status: "completed",
    created_at: new Date()
  };
  payments.set(payment.id, payment);
  res.json(payment);
});

// QR payment - generate
router.post("/qr/generate", async (req: Request, res: Response) => {
  const { guest_id, amount } = req.body;
  res.json({
    qr_code: `PAY_${uuidv4().slice(0, 8).toUpperCase()}`,
    amount,
    expires: new Date(Date.now() + 300000)
  });
});

// QR payment - scan
router.post("/qr/scan", async (req: Request, res: Response) => {
  const { qr_code, amount } = req.body;
  res.json({
    status: "completed",
    amount,
    timestamp: new Date().toISOString()
  });
});

export default router;