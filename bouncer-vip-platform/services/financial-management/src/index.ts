import express, { Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";

const router = express.Router();

// Payment types
interface Payment {
  id: string;
  guest_id: string;
  amount: number;
  currency: string;
  method: "card" | "cash" | "mobile" | "qr";
  status: "pending" | "completed" | "failed" | "refunded";
  description: string;
  created_at: Date;
}

interface Invoice {
  id: string;
  guest_id: string;
  items: InvoiceItem[];
  subtotal: number;
  tax: number;
  total: number;
  status: "draft" | "sent" | "paid" | "overdue";
  due_date: Date;
}

interface InvoiceItem {
  description: string;
  quantity: number;
  unit_price: number;
  total: number;
}

const payments: Map<string, Payment> = new Map();
const invoices: Map<string, Invoice> = new Map();

// Process payment
router.post("/payments", async (req: Request, res: Response) => {
  const payment: Payment = {
    id: uuidv4(),
    guest_id: req.body.guest_id,
    amount: req.body.amount,
    currency: req.body.currency || "ZAR",
    method: req.body.method || "card",
    status: "pending",
    description: req.body.description,
    created_at: new Date()
  };
  
  // Simulate payment processing
  payment.status = "completed";
  
  payments.set(payment.id, payment);
  res.status(201).json(payment);
});

// Get payments
router.get("/payments", async (req: Request, res: Response) => {
  const guestId = req.query.guest_id as string;
  let list = Array.from(payments.values());
  if (guestId) list = list.filter(p => p.guest_id === guestId);
  res.json({ payments: list });
});

// Create invoice
router.post("/invoices", async (req: Request, res: Response) => {
  const items = req.body.items || [];
  const subtotal = items.reduce((sum, i) => sum + (i.quantity * i.unit_price), 0);
  const tax = subtotal * 0.15; // 15% VAT
  const total = subtotal + tax;
  
  const invoice: Invoice = {
    id: uuidv4(),
    guest_id: req.body.guest_id,
    items,
    subtotal,
    tax,
    total,
    status: "draft",
    due_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days
  };
  
  invoices.set(invoice.id, invoice);
  res.status(201).json(invoice);
});

// Get invoices
router.get("/invoices", async (req: Request, res: Response) => {
  let list = Array.from(invoices.values());
  const status = req.query.status as string;
  if (status) list = list.filter(i => i.status === status);
  res.json({ invoices: list });
});

// Pay invoice
router.put("/invoices/:id/pay", async (req: Request, res: Response) => {
  const invoice = invoices.get(req.params.id);
  if (!invoice) return res.status(404).json({ error: "Invoice not found" });
  
  invoice.status = "paid";
  
  // Create payment
  const payment: Payment = {
    id: uuidv4(),
    guest_id: invoice.guest_id,
    amount: invoice.total,
    currency: "ZAR",
    method: "card",
    status: "completed",
    description: `Invoice #${invoice.id}`,
    created_at: new Date()
  };
  payments.set(payment.id, payment);
  
  invoices.set(invoice.id, invoice);
  res.json({ invoice, payment });
});

// Analytics
router.get("/analytics", async (req: Request, res: Response) => {
  const paymentList = Array.from(payments.values());
  const totalRevenue = paymentList
    .filter(p => p.status === "completed")
    .reduce((sum, p) => sum + p.amount, 0);
  
  res.json({
    total_payments: paymentList.length,
    total_revenue: totalRevenue,
    by_method: {
      card: paymentList.filter(p => p.method === "card").length,
      cash: paymentList.filter(p => p.method === "cash").length,
      mobile: paymentList.filter(p => p.method === "mobile").length
    }
  });
});

export default router;