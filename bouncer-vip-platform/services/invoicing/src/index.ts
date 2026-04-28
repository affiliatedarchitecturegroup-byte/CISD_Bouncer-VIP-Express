// ===========================================
// Advanced Invoicing Service
// Recurring invoices, templates & automated reminders
// ===========================================

import express, { Request, Response } from 'express';
import { Pool } from 'pg';
import Redis from 'ioredis';
import { v4 as uuidv4 } from 'uuid';
import { addDays, format } from 'date-fns';

const app = express();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const redis = new Redis(process.env.REDIS_URL);

app.use(express.json());

// ===========================================
// Types
// ===========================================

type InvoiceStatus = 'draft' | 'sent' | 'viewed' | 'partial' | 'paid' | 'overdue' | 'cancelled';
type InvoiceType = 'service' | 'product' | 'rental' | 'emergency';

interface Invoice {
  id: string;
  invoice_number: string;
  venue_id: string;
  client_name: string;
  client_email: string;
  client_address: string;
  type: InvoiceType;
  status: InvoiceStatus;
  subtotal: number;
  vat_rate: number;
  vat_amount: number;
  total: number;
  due_date: string;
  paid_at?: string;
  line_items: { description: string; quantity: number; rate: number; amount: number }[];
}

interface RecurringInvoice {
  id: string;
  template_id: string;
  venue_id: string;
  frequency: 'weekly' | 'biweekly' | 'monthly' | 'quarterly';
  next_run: string;
  auto_send: boolean;
  active: boolean;
}

interface InvoiceTemplate {
  id: string;
  name: string;
  default_description: string;
  default_line_items: { description: string; quantity: number; rate: number }[];
  vat_rate: number;
  payment_terms_days: number;
}

// ===========================================
// Invoice CRUD
// ===========================================

async function createInvoice(data: Partial<Invoice>): Promise<Invoice> {
  const id = uuidv4();
  const invoiceNumber = await generateInvoiceNumber();
  
  // Calculate totals
  const subtotal = data.line_items?.reduce((sum, item) => sum + item.amount, 0) || 0;
  const vatRate = data.vat_rate || 15;
  const vatAmount = subtotal * (vatRate / 100);
  const total = subtotal + vatAmount;
  
  const [invoice] = await pool.query(`
    INSERT INTO invoices (id, invoice_number, venue_id, client_name, client_email, client_address,
                       type, status, subtotal, vat_rate, vat_amount, total, due_date)
    VALUES ($1, $2, $3, $4, $5, $6, $7, 'draft', $8, $9, $10, $11, $12)
    RETURNING *
  `, [id, invoiceNumber, data.venue_id, data.client_name, data.client_email, data.client_address,
      data.type, subtotal, vatRate, vatAmount, total, data.due_date]);
  
  // Insert line items
  for (const item of data.line_items || []) {
    await pool.query(`
      INSERT INTO invoice_items (id, invoice_id, description, quantity, rate, amount)
      VALUES ($1, $2, $3, $4, $5, $6)
    `, [uuidv4(), id, item.description, item.quantity, item.rate, item.amount]);
  }
  
  return { ...invoice, line_items: data.line_items || [] };
}

async function generateInvoiceNumber(): Promise<string> {
  const year = format(new Date(), 'yyyy');
  const prefix = `INV-${year}-`;
  
  const result = await pool.query(`
    SELECT invoice_number FROM invoices 
    WHERE invoice_number LIKE $1
    ORDER BY created_at DESC LIMIT 1
  `, [`${prefix}%`]);
  
  if (!result.rows[0]) return `${prefix}0001`;
  
  const lastNum = parseInt(result.rows[0].invoice_number.replace(prefix, ''));
  return `${prefix}${String(lastNum + 1).padStart(4, '0')}`;
}

async function getInvoices(filters?: {
  venue_id?: string;
  status?: InvoiceStatus;
  from_date?: string;
  to_date?: string;
}): Promise<Invoice[]> {
  let query = 'SELECT * FROM invoices WHERE deleted_at IS NULL';
  const params: any[] = [];
  
  if (filters?.venue_id) {
    params.push(filters.venue_id);
    query += ` AND venue_id = $${params.length}`;
  }
  if (filters?.status) {
    params.push(filters.status);
    query += ` AND status = $${params.length}`;
  }
  if (filters?.from_date) {
    params.push(filters.from_date);
    query += ` AND created_at >= $${params.length}`;
  }
  if (filters?.to_date) {
    params.push(filters.to_date);
    query += ` AND created_at <= $${params.length}`;
  }
  
  query += ' ORDER BY created_at DESC';
  const result = await pool.query(query, params);
  
  const invoices: Invoice[] = [];
  for (const inv of result.rows) {
    const items = await pool.query('SELECT * FROM invoice_items WHERE invoice_id = $1', [inv.id]);
    invoices.push({ ...inv, line_items: items.rows });
  }
  
  return invoices;
}

async function sendInvoice(invoiceId: string): Promise<void> {
  const invoice = await pool.query('SELECT * FROM invoices WHERE id = $1', [invoiceId]);
  if (!invoice.rows[0]) throw new Error('Invoice not found');
  
  // Update status
  await pool.query(`
    UPDATE invoices SET status = 'sent', sent_at = NOW(), updated_at = NOW()
    WHERE id = $1
  `, [invoiceId]);
  
  // Send email (in production, use email service)
  // await emailService.sendInvoice(invoice.rows[0]);
  
  // Queue reminder if overdue
  await scheduleReminder(invoiceId, invoice.rows[0].due_date);
}

async function markAsPaid(invoiceId: string, paymentReference: string): Promise<void> {
  await pool.query(`
    UPDATE invoices 
    SET status = 'paid', paid_at = NOW(), payment_reference = $1, updated_at = NOW()
    WHERE id = $2
  `, [paymentReference, invoiceId]);
  
  // Remove scheduled reminders
  await redis.del(`reminder:${invoiceId}`);
}

async function cancelInvoice(invoiceId: string, reason: string): Promise<void> {
  await pool.query(`
    UPDATE invoices 
    SET status = 'cancelled', cancellation_reason = $1, updated_at = NOW()
    WHERE id = $2
  `, [reason, invoiceId]);
}

// ===========================================
// Recurring Invoices
// ===========================================

async function createTemplate(data: Partial<InvoiceTemplate>): Promise<InvoiceTemplate> {
  const id = uuidv4();
  const [template] = await pool.query(`
    INSERT INTO invoice_templates (id, name, default_description, default_line_items, vat_rate, payment_terms_days)
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING *
  `, [id, data.name, data.default_description, JSON.stringify(data.default_line_items), data.vat_rate, data.payment_terms_days]);
  return template;
}

async function createRecurringInvoice(data: Partial<RecurringInvoice>): Promise<RecurringInvoice> {
  const id = uuidv4();
  await pool.query(`
    INSERT INTO recurring_invoices (id, template_id, venue_id, frequency, next_run, auto_send, active)
    VALUES ($1, $2, $3, $4, $5, $6, true)
  `, [id, data.template_id, data.venue_id, data.frequency, data.next_run, data.auto_send]);
  return { id, ...data } as RecurringInvoice;
}

async function processRecurringInvoices(): Promise<number> {
  const now = new Date();
  const dueDate = addDays(now, 30); // Default payment terms
  
  const recurring = await pool.query(`
    SELECT r.*, t.default_line_items, t.vat_rate, t.default_description,
           v.name as client_name, v.email as client_email, v.address as client_address
    FROM recurring_invoices r
    JOIN invoice_templates t ON r.template_id = t.id
    JOIN venues v ON r.venue_id = v.id
    WHERE r.active = true AND r.next_run <= $1
  `, [now]);
  
  let created = 0;
  for (const rec of recurring.rows) {
    const lineItems = JSON.parse(rec.default_line_items).map((item: any) => ({
      ...item,
      amount: item.quantity * item.rate,
    }));
    
    await createInvoice({
      venue_id: rec.venue_id,
      client_name: rec.client_name,
      client_email: rec.client_email,
      client_address: rec.client_address,
      type: 'service',
      line_items: lineItems,
      vat_rate: rec.vat_rate,
      due_date: dueDate,
    });
    
    // Calculate next run date
    let nextRun = new Date(rec.next_run);
    switch (rec.frequency) {
      case 'weekly': nextRun = addDays(nextRun, 7); break;
      case 'biweekly': nextRun = addDays(nextRun, 14); break;
      case 'monthly': nextRun = addMonths(nextRun, 1); break;
      case 'quarterly': nextRun = addMonths(nextRun, 3); break;
    }
    
    await pool.query(`
      UPDATE recurring_invoices SET next_run = $1 WHERE id = $2
    `, [nextRun, rec.id]);
    
    created++;
  }
  
  return created;
}

// ===========================================
// Reminders
// ===========================================

async function scheduleReminder(invoiceId: string, dueDate: string): Promise<void> {
  const due = new Date(dueDate);
  const reminderDays = [7, 3, 0]; // Days before due date to remind
  
  for (const days of reminderDays) {
    const reminderDate = addDays(due, -days);
    if (reminderDate > new Date()) {
      await redis.zadd('invoice:reminders', reminderDate.getTime(), `${invoiceId}:${days}`);
    }
  }
}

async function processReminders(): Promise<void> {
  const now = Date.now();
  const reminders = await redis.zrangebyscore('invoice:reminders', 0, now);
  
  for (const reminder of reminders) {
    const [invoiceId, days] = reminder.split(':');
    await sendReminder(invoiceId, parseInt(days));
    await redis.zrem('invoice:reminders', reminder);
  }
}

async function sendReminder(invoiceId: string, daysBeforeDue: number): Promise<void> {
  const invoice = await pool.query('SELECT * FROM invoices WHERE id = $1', [invoiceId]);
  if (!invoice.rows[0] || invoice.rows[0].status === 'paid') return;
  
  let subject = '';
  let message = '';
  
  if (daysBeforeDue === 7) {
    subject = `Payment Reminder: Invoice ${invoice.rows[0].invoice_number} due in 7 days`;
    message = `Your invoice is due in 7 days. Please arrange payment.`;
  } else if (daysBeforeDue === 3) {
    subject = `Final Reminder: Invoice ${invoice.rows[0].invoice_number} due in 3 days`;
    message = `Your invoice is due in 3 days. Please arrange immediate payment.`;
  } else {
    subject = `OVERDUE: Invoice ${invoice.rows[0].invoice_number}`;
    message = `Your invoice is now overdue. Please arrange payment immediately.`;
    
    await pool.query(`
      UPDATE invoices SET status = 'overdue', updated_at = NOW() WHERE id = $1
    `, [invoiceId]);
  }
  
  // In production, send email
  console.log(`Reminder for ${invoiceId}: ${message}`);
}

// ===========================================
// Reports
// ===========================================

async function getInvoiceAnalytics(dateRange?: { start: string; end: string }): Promise<{
  total_invoiced: number;
  total_paid: number;
  total_outstanding: number;
  overdue_amount: number;
  average_payment_days: number;
  by_status: Record<string, number>;
  by_venue: { venue_id: string; amount: number }[];
}> {
  let query = 'SELECT status, SUM(total) as amount FROM invoices WHERE deleted_at IS NULL';
  const params: any[] = [];
  
  if (dateRange) {
    params.push(dateRange.start, dateRange.end);
    query += ` AND created_at BETWEEN $1 AND $2`;
  }
  
  query += ' GROUP BY status';
  const statusResult = await pool.query(query, params);
  
  let totalInvoiced = 0, totalPaid = 0, totalOutstanding = 0, overdueAmount = 0;
  const byStatus: Record<string, number> = {};
  
  for (const row of statusResult.rows) {
    byStatus[row.status] = parseFloat(row.amount);
    totalInvoiced += parseFloat(row.amount);
    if (row.status === 'paid') totalPaid += parseFloat(row.amount);
    if (['sent', 'viewed', 'partial'].includes(row.status)) totalOutstanding += parseFloat(row.amount);
    if (row.status === 'overdue') overdueAmount += parseFloat(row.amount);
  }
  
  // Average payment days
  const paymentDays = await pool.query(`
    SELECT AVG(EXTRACT(EPOCH FROM (paid_at - sent_at)) / 86400) as avg_days
    FROM invoices WHERE status = 'paid' AND paid_at IS NOT NULL
  `);
  
  return {
    total_invoiced: totalInvoiced,
    total_paid: totalPaid,
    total_outstanding: totalOutstanding,
    overdue_amount: overdueAmount,
    average_payment_days: parseFloat(paymentDays.rows[0]?.avg_days || '0'),
    by_status: byStatus,
    by_venue: [],
  };
}

// ===========================================
// API Routes
// ===========================================

app.post('/api/invoices', async (req: Request, res: Response) => {
  try {
    const invoice = await createInvoice(req.body);
    res.status(201).json({ success: true, data: invoice });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to create invoice' });
  }
});

app.get('/api/invoices', async (req: Request, res: Response) => {
  try {
    const invoices = await getInvoices(req.query as any);
    res.json({ success: true, data: invoices });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch invoices' });
  }
});

app.get('/api/invoices/:id', async (req: Request, res: Response) => {
  try {
    const invoice = await pool.query('SELECT * FROM invoices WHERE id = $1', [req.params.id]);
    if (!invoice.rows[0]) return res.status(404).json({ success: false, error: 'Invoice not found' });
    const items = await pool.query('SELECT * FROM invoice_items WHERE invoice_id = $1', [req.params.id]);
    res.json({ success: true, data: { ...invoice.rows[0], line_items: items.rows } });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch invoice' });
  }
});

app.post('/api/invoices/:id/send', async (req: Request, res: Response) => {
  try {
    await sendInvoice(req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to send invoice' });
  }
});

app.post('/api/invoices/:id/paid', async (req: Request, res: Response) => {
  try {
    const { reference } = req.body;
    await markAsPaid(req.params.id, reference);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to mark as paid' });
  }
});

app.post('/api/invoices/:id/cancel', async (req: Request, res: Response) => {
  try {
    const { reason } = req.body;
    await cancelInvoice(req.params.id, reason);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to cancel invoice' });
  }
});

// Templates
app.post('/api/templates', async (req: Request, res: Response) => {
  try {
    const template = await createTemplate(req.body);
    res.status(201).json({ success: true, data: template });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to create template' });
  }
});

// Recurring
app.post('/api/recurring', async (req: Request, res: Response) => {
  try {
    const recurring = await createRecurringInvoice(req.body);
    res.status(201).json({ success: true, data: recurring });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to create recurring invoice' });
  }
});

app.get('/api/recurring', async (req: Request, res: Response) => {
  try {
    const recurring = await pool.query('SELECT * FROM recurring_invoices WHERE active = true');
    res.json({ success: true, data: recurring.rows });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch recurring invoices' });
  }
});

// Analytics
app.get('/api/analytics', async (req: Request, res: Response) => {
  try {
    const { start, end } = req.query as any;
    const analytics = await getInvoiceAnalytics({ start, end });
    res.json({ success: true, data: analytics });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch analytics' });
  }
});

app.get('/health', async (req: Request, res: Response) => {
  res.json({ status: 'healthy', service: 'invoicing' });
});

const PORT = process.env.PORT || 3023;

app.listen(PORT, () => console.log(`Invoicing Service on port ${PORT}`));

export default app;