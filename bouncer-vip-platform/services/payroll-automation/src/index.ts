// ===========================================
// Payroll Automation Service
// Automated payroll processing for Bouncer VIP Platform
// ===========================================

import express, { Request, Response } from 'express';
import { Pool } from 'pg';
import Redis from 'ioredis';
import { v4 as uuidv4 } from 'uuid';
import { addDays, addMonths, startOfMonth, endOfMonth, format } from 'date-fns';

const app = express();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const redis = new Redis(process.env.REDIS_URL);

app.use(express.json());

// ===========================================
// Types
// ===========================================

type PayPeriod = 'weekly' | 'biweekly' | 'monthly';
type DeductionType = 'tax' | 'uif' | 'pension' | 'medical_aid' | 'other';
type PaymentStatus = 'calculated' | 'approved' | 'paid' | 'failed';

interface PaySlip {
  id: string;
  officer_id: string;
  period_start: string;
  period_end: string;
  gross_salary: number;
  total_deductions: number;
  net_salary: number;
  status: PaymentStatus;
  paid_at?: string;
}

interface Deduction {
  type: DeductionType;
  description: string;
  rate?: number;
  fixed_amount?: number;
  calculated_on?: 'gross' | 'net';
  employer_contribution?: number;
}

// ===========================================
// Rate Calculation
// ===========================================

interface ShiftRate {
  standard_hours: number;
  standard_rate: number;
  overtime_multiplier: number;
  sunday_multiplier: number;
  public_holiday_multiplier: number;
  night_shift_multiplier: number;
}

async function calculateShiftEarnings(
  officerId: string,
  periodStart: Date,
  periodEnd: Date
): Promise<{
  regular_hours: number;
  overtime_hours: number;
  sunday_hours: number;
  ph_hours: number;
  regular_earnings: number;
  overtime_earnings: number;
  sunday_earnings: number;
  ph_earnings: number;
  total_earnings: number;
  shifts: { id: string; hours: number; rate: number; earnings: number; type: string }[];
}> {
  const rates = await getOfficerRates(officerId);
  const shifts = await pool.query(`
    SELECT s.id, s.start_time, s.end_time, s.actual_hours, s.hourly_rate,
           s.check_in_time, s.check_out_time, s.status,
           CASE WHEN s.service_type = 'emergency' THEN 1 ELSE 0 END as is_emergency,
           EXTRACT(DOW FROM s.start_time) as day_of_week,
           s.start_time < '06:00' OR s.end_time > '22:00' as is_night
    FROM shifts s
    WHERE s.officer_id = $1
      AND s.check_in_time >= $2
      AND s.check_in_time <= $3
      AND s.status IN ('clocked_in', 'clocked_out')
  `, [officerId, periodStart, periodEnd]);
  
  let regularHours = 0, overtimeHours = 0, sundayHours = 0, phHours = 0;
  let regularEarnings = 0, overtimeEarnings = 0, sundayEarnings = 0, phEarnings = 0;
  const shiftDetails: any[] = [];
  
  const holidays = await getPublicHolidays(periodStart, periodEnd);
  
  for (const shift of shifts.rows) {
    const hours = shift.actual_hours || 8;
    const hourlyRate = shift.hourly_rate || rates.standard_rate;
    const dayOfWeek = shift.day_of_week;
    const isSunday = dayOfWeek === 0;
    const isHoliday = holidays.some(h => h === format(new Date(shift.start_time), 'yyyy-MM-dd'));
    const isNight = shift.is_night;
    
    let shiftEarnings = 0;
    let shiftType = 'regular';
    
    if (isHoliday) {
      phHours += hours;
      shiftEarnings = hours * hourlyRate * rates.public_holiday_multiplier;
      shiftType = 'public_holiday';
    } else if (isSunday) {
      sundayHours += hours;
      shiftEarnings = hours * hourlyRate * rates.sunday_multiplier;
      shiftType = 'sunday';
    } else if (hours > rates.standard_hours) {
      const regular = rates.standard_hours;
      const overtime = hours - regular;
      overtimeHours += overtime;
      regularHours += regular;
      regularEarnings += regular * hourlyRate;
      overtimeEarnings += overtime * hourlyRate * rates.overtime_multiplier;
      shiftDetails.push({
        id: shift.id,
        hours: regular,
        rate: hourlyRate,
        earnings: regular * hourlyRate,
        type: 'regular',
      });
      shiftDetails.push({
        id: shift.id,
        hours: overtime,
        rate: hourlyRate * rates.overtime_multiplier,
        earnings: overtime * hourlyRate * rates.overtime_multiplier,
        type: 'overtime',
      });
      continue;
    } else {
      regularHours += hours;
      regularEarnings += hours * hourlyRate;
      if (isNight) {
        shiftEarnings = hours * hourlyRate * rates.night_shift_multiplier;
        shiftType = 'night';
      }
    }
    
    if (shiftType !== 'overtime') {
      shiftEarnings = shiftEarnings || hours * hourlyRate;
      shiftDetails.push({
        id: shift.id,
        hours,
        rate: hourlyRate,
        earnings: shiftEarnings,
        type: shiftType,
      });
    }
  }
  
  return {
    regular_hours: regularHours,
    overtime_hours: overtimeHours,
    sunday_hours: sundayHours,
    ph_hours: phHours,
    regular_earnings: regularEarnings,
    overtime_earnings: overtimeEarnings,
    sunday_earnings: sundayEarnings,
    ph_earnings: phEarnings,
    total_earnings: regularEarnings + overtimeEarnings + sundayEarnings + phEarnings,
    shifts: shiftDetails,
  };
}

async function getOfficerRates(officerId: string): Promise<ShiftRate> {
  const contract = await pool.query(`
    SELECT hourly_rate, hours_per_week FROM contracts 
    WHERE officer_id = $1 AND status = 'active'
  `, [officerId]);
  
  return {
    standard_hours: 45,
    standard_rate: contract.rows[0]?.hourly_rate || 150,
    overtime_multiplier: 1.5,
    sunday_multiplier: 2.0,
    public_holiday_multiplier: 2.5,
    night_shift_multiplier: 1.25,
  };
}

async function getPublicHolidays(start: Date, end: Date): Promise<string[]> {
  // South African public holidays
  const holidays = [
    '2024-01-01', '2024-03-21', '2024-04-01', '2024-04-02',
    '2024-04-27', '2024-05-01', '2024-06-17', '2024-08-09',
    '2024-09-24', '2024-12-16', '2024-12-25', '2024-12-26',
  ];
  return holidays.filter(h => h >= format(start, 'yyyy-MM-dd') && h <= format(end, 'yyyy-MM-dd'));
}

// ===========================================
// Deductions
// ===========================================

async function calculateDeductions(
  grossSalary: number,
  deductions: Deduction[]
): Promise<{ type: DeductionType; amount: number }[]> {
  const results: { type: DeductionType; amount: number }[] = [];
  
  for (const ded of deductions) {
    let amount = 0;
    
    if (ded.fixed_amount) {
      amount = ded.fixed_amount;
    } else if (ded.rate) {
      const base = ded.calculated_on === 'net' ? grossSalary : grossSalary;
      amount = base * (ded.rate / 100);
    }
    
    if (amount > 0) {
      results.push({ type: ded.type, amount });
    }
  }
  
  // South African tax brackets (simplified)
  const tax = calculatePAYE(grossSalary);
  results.push({ type: 'tax', amount: tax });
  
  // UIF (1% of earnings, max R148.16 per month)
  const uif = Math.min(grossSalary * 0.01, 148.16);
  results.push({ type: 'uif', amount: uif });
  
  return results;
}

function calculatePAYE(monthlyIncome: number): number {
  // Tax brackets 2024 (simplified)
  if (monthlyIncome <= 11600) return monthlyIncome * 0.18;
  if (monthlyIncome <= 23100) return 2088 + (monthlyIncome - 11600) * 0.26;
  if (monthlyIncome <= 35700) return 5078 + (monthlyIncome - 23100) * 0.31;
  if (monthlyIncome <= 50000) return 8984 + (monthlyIncome - 35700) * 0.36;
  if (monthlyIncome <= 64100) return 14132 + (monthlyIncome - 50000) * 0.39;
  if (monthlyIncome <= 85700) return 19631 + (monthlyIncome - 64100) * 0.41;
  if (monthlyIncome <= 96100) return 28487 + (monthlyIncome - 85700) * 0.45;
  return 33170 + (monthlyIncome - 96100) * 0.47;
}

// ===========================================
// Payroll Processing
// ===========================================

async function processPayroll(
  periodStart: Date,
  periodEnd: Date,
  officerIds?: string[]
): Promise<PaySlip[]> {
  const paySlips: PaySlip[] = [];
  
  // Get officers to process
  const officers = officerIds 
    ? await pool.query('SELECT id FROM officers WHERE id = ANY($1)', [officerIds])
    : await pool.query("SELECT id FROM officers WHERE status = 'active'");
  
  for (const officer of officers.rows) {
    const earnings = await calculateShiftEarnings(officer.id, periodStart, periodEnd);
    const deductions = await calculateDeductions(earnings.total_earnings, []);
    const totalDeductions = deductions.reduce((sum, d) => sum + d.amount, 0);
    
    const id = uuidv4();
    const [paySlip] = await pool.query(`
      INSERT INTO pay_slips (id, officer_id, period_start, period_end, gross_salary, total_deductions, net_salary, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'calculated')
      RETURNING *
    `, [id, officer.id, periodStart, periodEnd, earnings.total_earnings, totalDeductions, earnings.total_earnings - totalDeductions]);
    
    // Store line items
    for (const shift of earnings.shifts) {
      await pool.query(`
        INSERT INTO pay_slip_items (id, pay_slip_id, description, hours, rate, amount, type)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `, [uuidv4(), id, `${shift.type} hours`, shift.hours, shift.rate, shift.earnings, shift.type]);
    }
    
    for (const ded of deductions) {
      await pool.query(`
        INSERT INTO pay_slip_deductions (id, pay_slip_id, type, amount)
        VALUES ($1, $2, $3, $4)
      `, [uuidv4(), id, ded.type, ded.amount]);
    }
    
    paySlips.push(paySlip);
  }
  
  return paySlips;
}

// ===========================================
// Bank File Generation (EFT)
// ===========================================

async function generateBankFile(paySlipIds: string[]): Promise<string> {
  const paySlips = await pool.query('SELECT * FROM pay_slips WHERE id = ANY($1)', [paySlipIds]);
  const officers = await pool.query(`
    SELECT o.id, o.bank_name, o.bank_account, o.bank_branch, p.net_salary
    FROM pay_slips p
    JOIN officers o ON p.officer_id = o.id
    WHERE p.id = ANY($1)
  `, [paySlipIds]);
  
  let file = '01\r\n'; // Header record type
  
  for (const officer of officers.rows) {
    // Standard Bank File format
    file += `${officer.bank_account.padEnd(13)}${officer.bank_branch.padEnd(11)}`;
    file += `${Math.round(officer.net_salary * 100).toString().padStart(13)}`;
    file += `${officer.id.padEnd(10)}\r\n`;
  }
  
  return file;
}

// ===========================================
// API Routes
// ===========================================

app.post('/api/payroll/process', async (req: Request, res: Response) => {
  try {
    const { period_start, period_end, officer_ids } = req.body;
    const paySlips = await processPayroll(new Date(period_start), new Date(period_end), officer_ids);
    res.status(201).json({ success: true, data: paySlips });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to process payroll' });
  }
});

app.get('/api/payroll/:periodId', async (req: Request, res: Response) => {
  try {
    const paySlips = await pool.query('SELECT * FROM pay_slips WHERE period_start = $1', [req.params.periodId]);
    res.json({ success: true, data: paySlips.rows });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch payroll' });
  }
});

app.get('/api/payroll/officer/:officerId/history', async (req: Request, res: Response) => {
  try {
    const history = await pool.query(`
      SELECT ps.*, SUM(psi.amount) as earnings, SUM(psd.amount) as deductions
      FROM pay_slips ps
      LEFT JOIN pay_slip_items psi ON ps.id = psi.pay_slip_id
      LEFT JOIN pay_slip_deductions psd ON ps.id = psd.pay_slip_id
      WHERE ps.officer_id = $1
      GROUP BY ps.id
      ORDER BY ps.period_start DESC
    `, [req.params.officerId]);
    res.json({ success: true, data: history.rows });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch history' });
  }
});

app.get('/api/payroll/officer/:officerId/latest', async (req: Request, res: Response) => {
  try {
    const latest = await pool.query(`
      SELECT ps.*, 
             (SELECT json_agg(json_build_object('description', psi.description, 'amount', psi.amount)) 
              FROM pay_slip_items psi WHERE psi.pay_slip_id = ps.id) as items,
             (SELECT json_agg(json_build_object('type', psd.type, 'amount', psd.amount)) 
              FROM pay_slip_deductions psd WHERE psd.pay_slip_id = ps.id) as deductions
      FROM pay_slips ps
      WHERE ps.officer_id = $1
      ORDER BY ps.period_start DESC
      LIMIT 1
    `, [req.params.officerId]);
    res.json({ success: true, data: latest.rows[0] });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch latest pay slip' });
  }
});

app.post('/api/payroll/:id/approve', async (req: Request, res: Response) => {
  try {
    await pool.query(`
      UPDATE pay_slips SET status = 'approved', updated_at = NOW() WHERE id = $1
    `, [req.params.id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to approve' });
  }
});

app.get('/api/payroll/:periodId/bank-file', async (req: Request, res: Response) => {
  try {
    const { ids } = req.query as any;
    const file = await generateBankFile(ids.split(','));
    res.set('Content-Type', 'text/plain');
    res.send(file);
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to generate bank file' });
  }
});

app.get('/api/analytics', async (req: Request, res: Response) => {
  try {
    const [total, byStatus] = await Promise.all([
      pool.query('SELECT SUM(net_salary) as total FROM pay_slips WHERE status = $1', ['paid']),
      pool.query('SELECT status, COUNT(*), SUM(net_salary) FROM pay_slips GROUP BY status'),
    ]);
    res.json({ success: true, data: { total: total.rows[0]?.total, by_status: byStatus.rows } });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch analytics' });
  }
});

app.get('/health', async (req: Request, res: Response) => {
  res.json({ status: 'healthy', service: 'payroll-automation' });
});

const PORT = process.env.PORT || 3022;

app.listen(PORT, () => console.log(`Payroll Automation Service on port ${PORT}`));

export default app;