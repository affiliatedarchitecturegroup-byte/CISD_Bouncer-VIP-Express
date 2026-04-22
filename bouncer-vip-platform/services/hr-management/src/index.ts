// ===========================================
// HR Management Service
// Leave management, contracts & employee records
// ===========================================

import express, { Request, Response } from 'express';
import { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';

const app = express();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

app.use(express.json());

// ===========================================
// Types
// ===========================================

type LeaveType = 'annual' | 'sick' | 'family' | 'maternity' | 'paternity' | 'unpaid' | 'study';
type LeaveStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';
type ContractType = 'permanent' | 'contract' | 'casual' | 'intern';

interface Leave {
  id: string;
  officer_id: string;
  type: LeaveType;
  start_date: string;
  end_date: string;
  days: number;
  reason?: string;
  status: LeaveStatus;
  approved_by?: string;
  approved_at?: string;
  rejection_reason?: string;
}

interface Contract {
  id: string;
  officer_id: string;
  type: ContractType;
  start_date: string;
  end_date?: string;
  hours_per_week: number;
  hourly_rate: number;
  probation_end_date?: string;
  notice_period_days: number;
  status: 'active' | 'expired' | 'terminated';
}

interface EmergencyContact {
  id: string;
  officer_id: string;
  name: string;
  relationship: string;
  phone: string;
  email?: string;
}

// ===========================================
// Leave Management
// ===========================================

async function applyForLeave(data: {
  officer_id: string;
  type: LeaveType;
  start_date: string;
  end_date: string;
  reason?: string;
}): Promise<Leave> {
  // Calculate days
  const start = new Date(data.start_date);
  const end = new Date(data.end_date);
  const days = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
  
  const id = uuidv4();
  const [leave] = await pool.query(`
    INSERT INTO leave_requests (id, officer_id, type, start_date, end_date, days, reason, status)
    VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending')
    RETURNING *
  `, [id, data.officer_id, data.type, data.start_date, data.end_date, days, data.reason]);
  
  return leave;
}

async function approveLeave(leaveId: string, approverId: string): Promise<Leave> {
  const [leave] = await pool.query(`
    UPDATE leave_requests 
    SET status = 'approved', approved_by = $1, approved_at = NOW()
    WHERE id = $2
    RETURNING *
  `, [approverId, leaveId]);
  
  // Update leave balance
  await pool.query(`
    UPDATE leave_balances 
    SET balance = balance - $1
    WHERE officer_id = (SELECT officer_id FROM leave_requests WHERE id = $2)
      AND leave_type = (SELECT type FROM leave_requests WHERE id = $2)
  `, [leave.days, leaveId]);
  
  return leave;
}

async function rejectLeave(leaveId: string, approverId: string, reason: string): Promise<Leave> {
  const [leave] = await pool.query(`
    UPDATE leave_requests 
    SET status = 'rejected', approved_by = $1, approved_at = NOW(), rejection_reason = $2
    WHERE id = $3
    RETURNING *
  `, [approverId, reason, leaveId]);
  
  return leave;
}

async function getLeaveHistory(officerId: string): Promise<Leave[]> {
  const result = await pool.query(`
    SELECT lr.*, a.first_name || ' ' || a.last_name as approved_by_name
    FROM leave_requests lr
    LEFT JOIN officers a ON lr.approved_by = a.id
    WHERE lr.officer_id = $1
    ORDER BY lr.start_date DESC
  `, [officerId]);
  return result.rows;
}

async function getPendingApprovals(managerId: string): Promise<any[]> {
  const result = await pool.query(`
    SELECT lr.*, o.first_name || ' ' || o.last_name as officer_name
    FROM leave_requests lr
    JOIN officers o ON lr.officer_id = o.id
    LEFT JOIN officer_managers om ON o.id = om.officer_id
    WHERE lr.status = 'pending'
      AND (om.manager_id = $1 OR o.team_lead_id = $1)
    ORDER BY lr.created_at
  `, [managerId]);
  return result.rows;
}

// ===========================================
// Leave Balance
// ===========================================

interface LeaveBalance {
  officer_id: string;
  leave_type: LeaveType;
  entitlement: number;
  balance: number;
  used: number;
  pending: number;
}

async function getLeaveBalances(officerId: string): Promise<LeaveBalance[]> {
  const result = await pool.query(`
    SELECT * FROM leave_balances WHERE officer_id = $1
  `, [officerId]);
  return result.rows;
}

async function updateLeaveEntitlement(year: number, leaveType: LeaveType, entitlement: number): Promise<void> {
  await pool.query(`
    UPDATE leave_balances 
    SET entitlement = $1
    WHERE leave_type = $2
  `, [entitlement, leaveType]);
}

// ===========================================
// Contracts
// ===========================================

async function createContract(data: Partial<Contract>): Promise<Contract> {
  const id = uuidv4();
  const [contract] = await pool.query(`
    INSERT INTO contracts (id, officer_id, type, start_date, end_date, hours_per_week, hourly_rate, notice_period_days)
    VALUES ($1, $2, $3, $4, $5, $6, $7, 14)
    RETURNING *
  `, [id, data.officer_id, data.type, data.start_date, data.end_date, data.hours_per_week, data.hourly_rate]);
  
  return contract;
}

async function terminateContract(contractId: string, reason: string, terminatedBy: string): Promise<void> {
  await pool.query(`
    UPDATE contracts 
    SET status = 'terminated', termination_reason = $1, terminated_by = $2, terminated_at = NOW()
    WHERE id = $3
  `, [reason, terminatedBy, contractId]);
  
  await pool.query(`
    UPDATE officers SET status = 'inactive', updated_at = NOW() 
    WHERE id = (SELECT officer_id FROM contracts WHERE id = $1)
  `, [contractId]);
}

async function getActiveContract(officerId: string): Promise<Contract | null> {
  const result = await pool.query(`
    SELECT * FROM contracts WHERE officer_id = $1 AND status = 'active'
  `, [officerId]);
  return result.rows[0] || null;
}

// ===========================================
// Employee Profile
// ===========================================

interface EmployeeProfile {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  id_number: string;
  tax_number?: string;
  uif_number?: string;
  bank_name?: string;
  bank_account?: string;
  bank_branch?: string;
  emergency_contacts: EmergencyContact[];
  contracts: Contract[];
  leave_balances: LeaveBalance[];
  address: {
    street: string;
    city: string;
    province: string;
    postal_code: string;
  };
}

async function getEmployeeProfile(officerId: string): Promise<EmployeeProfile | null> {
  const [officer, contacts, contracts, balances] = await Promise.all([
    pool.query('SELECT * FROM officers WHERE id = $1', [officerId]),
    pool.query('SELECT * FROM emergency_contacts WHERE officer_id = $1', [officerId]),
    pool.query('SELECT * FROM contracts WHERE officer_id = $1', [officerId]),
    pool.query('SELECT * FROM leave_balances WHERE officer_id = $1', [officerId]),
  ]);
  
  if (!officer.rows[0]) return null;
  
  return {
    ...officer.rows[0],
    emergency_contacts: contacts.rows,
    contracts: contracts.rows,
    leave_balances: balances.rows,
  };
}

async function updateEmployeeProfile(officerId: string, data: Partial<EmployeeProfile>): Promise<void> {
  const updates: string[] = [];
  const params: any[] = [];
  
  if (data.bank_name) { params.push(data.bank_name); updates.push(`bank_name = $${params.length}`); }
  if (data.bank_account) { params.push(data.bank_account); updates.push(`bank_account = $${params.length}`); }
  if (data.bank_branch) { params.push(data.bank_branch); updates.push(`bank_branch = $${params.length}`); }
  
  if (updates.length > 0) {
    params.push(officerId);
    await pool.query(`
      UPDATE officers SET ${updates.join(', ')}, updated_at = NOW() WHERE id = $${params.length}
    `, params);
  }
}

async function addEmergencyContact(officerId: string, contact: Partial<EmergencyContact>): Promise<EmergencyContact> {
  const id = uuidv4();
  const [newContact] = await pool.query(`
    INSERT INTO emergency_contacts (id, officer_id, name, relationship, phone, email)
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING *
  `, [id, officerId, contact.name, contact.relationship, contact.phone, contact.email]);
  return newContact;
}

// ===========================================
// Onboarding Checklist
// ===========================================

interface OnboardingItem {
  id: string;
  title: string;
  description: string;
  required: boolean;
  category: 'documents' | 'training' | 'equipment' | 'admin';
}

async function getOnboardingChecklist(): Promise<OnboardingItem[]> {
  const result = await pool.query('SELECT * FROM onboarding_items ORDER BY category, title');
  return result.rows;
}

async function completeOnboardingItem(officerId: string, itemId: string): Promise<void> {
  await pool.query(`
    INSERT INTO officer_onboarding (officer_id, item_id, completed_at)
    VALUES ($1, $2, NOW())
    ON CONFLICT DO NOTHING
  `, [officerId, itemId]);
}

async function getOnboardingProgress(officerId: string): Promise<{ completed: number; total: number; percent: number }> {
  const [completed, total] = await Promise.all([
    pool.query(`
      SELECT COUNT(*) as count FROM officer_onboarding WHERE officer_id = $1
    `, [officerId]),
    pool.query('SELECT COUNT(*) as count FROM onboarding_items'),
  ]);
  
  const completedCount = parseInt(completed.rows[0]?.count || 0);
  const totalCount = parseInt(total.rows[0]?.count || 0);
  
  return {
    completed: completedCount,
    total: totalCount,
    percent: totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0,
  };
}

// ===========================================
// Offboarding
// ===========================================

async function initiateOffboarding(officerId: string, reason: string, noticeDate: string): Promise<void> {
  // Create offboarding record
  await pool.query(`
    INSERT INTO offboarding_records (id, officer_id, reason, notice_date, status)
    VALUES ($1, $2, $3, $4, 'initiated')
  `, [uuidv4(), officerId, reason, noticeDate]);
  
  // Update status
  await pool.query(`
    UPDATE officers SET status = 'notice_period', updated_at = NOW() WHERE id = $1
  `, [officerId]);
}

async function completeOffboarding(officerId: string, exitInterview?: string): Promise<void> {
  await pool.query(`
    UPDATE offboarding_records 
    SET status = 'completed', exit_interview = $1, completed_at = NOW()
    WHERE officer_id = $2
  `, [exitInterview, officerId]);
  
  await pool.query(`
    UPDATE officers 
    SET status = 'inactive', deleted_at = NOW(), updated_at = NOW() 
    WHERE id = $1
  `, [officerId]);
}

// ===========================================
// API Routes
// ===========================================

// Leave
app.post('/api/leave', async (req: Request, res: Response) => {
  try {
    const leave = await applyForLeave(req.body);
    res.status(201).json({ success: true, data: leave });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to apply for leave' });
  }
});

app.get('/api/leave/:officerId', async (req: Request, res: Response) => {
  try {
    const history = await getLeaveHistory(req.params.officerId);
    res.json({ success: true, data: history });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch leave history' });
  }
});

app.post('/api/leave/:id/approve', async (req: Request, res: Response) => {
  try {
    const { approver_id } = req.body;
    const leave = await approveLeave(req.params.id, approver_id);
    res.json({ success: true, data: leave });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to approve leave' });
  }
});

app.post('/api/leave/:id/reject', async (req: Request, res: Response) => {
  try {
    const { approver_id, reason } = req.body;
    const leave = await rejectLeave(req.params.id, approver_id, reason);
    res.json({ success: true, data: leave });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to reject leave' });
  }
});

app.get('/api/leave/pending', async (req: Request, res: Response) => {
  try {
    const { manager_id } = req.query as any;
    const pending = await getPendingApprovals(manager_id);
    res.json({ success: true, data: pending });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch pending approvals' });
  }
});

// Balances
app.get('/api/leave/:officerId/balance', async (req: Request, res: Response) => {
  try {
    const balances = await getLeaveBalances(req.params.officerId);
    res.json({ success: true, data: balances });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch balances' });
  }
});

// Contracts
app.post('/api/contracts', async (req: Request, res: Response) => {
  try {
    const contract = await createContract(req.body);
    res.status(201).json({ success: true, data: contract });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to create contract' });
  }
});

app.get('/api/contracts/:officerId', async (req: Request, res: Response) => {
  try {
    const contract = await getActiveContract(req.params.officerId);
    res.json({ success: true, data: contract });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch contract' });
  }
});

// Profile
app.get('/api/employees/:officerId', async (req: Request, res: Response) => {
  try {
    const profile = await getEmployeeProfile(req.params.officerId);
    if (!profile) return res.status(404).json({ success: false, error: 'Employee not found' });
    res.json({ success: true, data: profile });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch profile' });
  }
});

app.put('/api/employees/:officerId', async (req: Request, res: Response) => {
  try {
    await updateEmployeeProfile(req.params.officerId, req.body);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to update profile' });
  }
});

app.post('/api/employees/:officerId/emergency-contact', async (req: Request, res: Response) => {
  try {
    const contact = await addEmergencyContact(req.params.officerId, req.body);
    res.status(201).json({ success: true, data: contact });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to add contact' });
  }
});

// Onboarding
app.get('/api/onboarding/checklist', async (req: Request, res: Response) => {
  try {
    const checklist = await getOnboardingChecklist();
    res.json({ success: true, data: checklist });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch checklist' });
  }
});

app.get('/api/onboarding/:officerId/progress', async (req: Request, res: Response) => {
  try {
    const progress = await getOnboardingProgress(req.params.officerId);
    res.json({ success: true, data: progress });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch progress' });
  }
});

// Health
app.get('/health', async (req: Request, res: Response) => {
  res.json({ status: 'healthy', service: 'hr-management' });
});

const PORT = process.env.PORT || 3020;

app.listen(PORT, () => console.log(`HR Management Service on port ${PORT}`));

export default app;