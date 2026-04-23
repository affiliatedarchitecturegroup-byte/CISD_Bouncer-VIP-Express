// ===========================================
// HR Platform Integration Service
// Workday, BambooHR sync
// ===========================================

import express, { Request, Response } from 'express';
import { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';
import axios from 'axios';

const app = express();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

app.use(express.json());

// ===========================================
// Types
// ===========================================

type HRProvider = 'workday' | 'bamboohr' | 'adp';

interface HREmployee {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  department?: string;
  jobTitle?: string;
  hireDate?: string;
  manager?: string;
  status: 'active' | 'inactive' | 'terminated';
}

// ===========================================
// Workday Integration
// ===========================================

class WorkdayIntegration {
  private baseUrl = 'https://wd2-impl-services1.workday.com';
  private tenant: string;
  private clientId: string;
  private clientSecret: string;

  constructor() {
    this.tenant = process.env.WORKDAY_TENANT || '';
    this.clientId = process.env.WORKDAY_CLIENT_ID || '';
    this.clientSecret = process.env.WORKDAY_CLIENT_SECRET || '';
  }

  async getEmployees(): Promise<HREmployee[]> {
    // In production, use Workday REST API
    // Simulated response
    return [];
  }

  async getEmployee(id: string): Promise<HREmployee | null> {
    return null;
  }

  async syncEmployee(employee: HREmployee): Promise<void> {
    // Create or update employee in Workday
    console.log(`Syncing employee ${employee.email} to Workday`);
  }

  async syncPayroll(payrollData: any): Promise<void> {
    console.log(`Syncing payroll to Workday`);
  }
}

// ===========================================
// BambooHR Integration
// ===========================================

class BambooHRIntegration {
  private baseUrl = 'https://api.bamboohr.com/api/gateway.php';
  private subdomain: string;
  private apiKey: string;

  constructor() {
    this.subdomain = process.env.BAMBOO_SUBDOMAIN || '';
    this.apiKey = process.env.BAMBOO_API_KEY || '';
  }

  private getAuth(): string {
    return Buffer.from(`${this.apiKey}:x`).toString('base64');
  }

  async getEmployees(): Promise<HREmployee[]> {
    const response = await axios.get(
      `${this.baseUrl}/${this.subdomain}/v1/employees/directory`,
      {
        headers: { 'Authorization': `Basic ${this.getAuth()}` },
      }
    );

    return response.data.employees.map((e: any) => ({
      id: e.id,
      firstName: e.firstName,
      lastName: e.lastName,
      email: e.workEmail,
      phone: e.mobilePhone,
      department: e.department,
      jobTitle: e.jobTitle,
      hireDate: e.hireDate,
      status: e.status === 'Active' ? 'active' : 'inactive',
    }));
  }

  async getEmployee(id: string): Promise<HREmployee | null> {
    const response = await axios.get(
      `${this.baseUrl}/${this.subdomain}/v1/employees/${id}`,
      {
        headers: { 'Authorization': `Basic ${this.getAuth()}` },
      }
    );

    const e = response.data;
    return {
      id: e.id,
      firstName: e.firstName,
      lastName: e.lastName,
      email: e.workEmail,
      phone: e.mobilePhone,
      department: e.department,
      jobTitle: e.jobTitle,
      hireDate: e.hireDate,
      status: e.status === 'Active' ? 'active' : 'inactive',
    };
  }

  async createEmployee(employee: HREmployee): Promise<{ hr_id: string }> {
    const response = await axios.post(
      `${this.baseUrl}/${this.subdomain}/v1/employees`,
      {
        firstName: employee.firstName,
        lastName: employee.lastName,
        workEmail: employee.email,
        mobilePhone: employee.phone,
        department: employee.department,
        jobTitle: employee.jobTitle,
      },
      {
        headers: { 
          'Authorization': `Basic ${this.getAuth()}`,
          'Content-Type': 'application/json',
        },
      }
    );

    return { hr_id: response.data.id };
  }

  async updateEmployee(id: string, updates: any): Promise<void> {
    await axios.patch(
      `${this.baseUrl}/${this.subdomain}/v1/employees/${id}`,
      updates,
      {
        headers: { 
          'Authorization': `Basic ${this.getAuth()}`,
          'Content-Type': 'application/json',
        },
      }
    );
  }

  async getTimeOffRequests(): Promise<any[]> {
    const response = await axios.get(
      `${this.baseUrl}/${this.subdomain}/v1/time_off/requests`,
      {
        headers: { 'Authorization': `Basic ${this.getAuth()}` },
      }
    );

    return response.data.requests;
  }

  async syncTimeOff(officerId: string, startDate: string, endDate: string, leaveType: string): Promise<void> {
    // Create time off request
    console.log(`Syncing time off for ${officerId}: ${leaveType}`);
  }
}

// ===========================================
// HR Service
// ===========================================

class HRService {
  private workday: WorkdayIntegration;
  private bamboohr: BambooHRIntegration;

  constructor() {
    this.workday = new WorkdayIntegration();
    this.bamboohr = new BambooHRIntegration();
  }

  async pullEmployees(provider: HRProvider): Promise<HREmployee[]> {
    if (provider === 'workday') {
      return this.workday.getEmployees();
    } else if (provider === 'bamboohr') {
      return this.bamboohr.getEmployees();
    }
    return [];
  }

  async syncEmployee(employee: HREmployee, provider: HRProvider): Promise<void> {
    if (provider === 'workday') {
      await this.workday.syncEmployee(employee);
    } else if (provider === 'bamboohr') {
      await this.bamboohr.createEmployee(employee);
    }
  }

  async importEmployees(provider: HRProvider): Promise<{ imported: number; errors: number }> {
    const employees = await this.pullEmployees(provider);
    let imported = 0, errors = 0;

    for (const emp of employees) {
      try {
        // Check if exists
        const existing = await pool.query(
          'SELECT id FROM officers WHERE email = $1',
          [emp.email]
        );

        if (existing.rows.length === 0) {
          await pool.query(`
            INSERT INTO officers (id, first_name, last_name, email, phone, department, psira_number, status)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          `, [uuidv4(), emp.firstName, emp.lastName, emp.email, emp.phone, emp.department, '', emp.status]);
          
          // Log sync
          await pool.query(`
            INSERT INTO hr_sync_logs (id, provider, entity_type, external_id, status, synced_at)
            VALUES ($1, $2, 'employee', $3, 'synced', NOW())
          `, [uuidv4(), provider, emp.id]);
          
          imported++;
        }
      } catch (error) {
        errors++;
      }
    }

    return { imported, errors };
  }

  async getTimeOffBalance(employeeId: string): Promise<any> {
    const result = await pool.query(`
      SELECT * FROM time_off_balances WHERE employee_id = $1
    `, [employeeId]);
    return result.rows[0];
  }

  async requestTimeOff(employeeId: string, data: {
    startDate: string;
    endDate: string;
    leaveType: string;
    reason?: string;
  }): Promise<void> {
    await pool.query(`
      INSERT INTO time_off_requests (id, employee_id, start_date, end_date, leave_type, reason, status)
      VALUES ($1, $2, $3, $4, $5, $6, 'pending')
    `, [uuidv4(), employeeId, data.startDate, data.endDate, data.leaveType, data.reason]);
  }
}

const hrService = new HRService();

// ===========================================
// API Routes
// ===========================================

app.post('/api/import/:provider', async (req: Request, res: Response) => {
  try {
    const { provider } = req.params;
    const result = await hrService.importEmployees(provider as HRProvider);
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Import failed' });
  }
});

app.get('/api/employees', async (req: Request, res: Response) => {
  try {
    const { provider } = req.query;
    const employees = await hrService.pullEmployees(provider as HRProvider);
    res.json({ success: true, data: employees });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch employees' });
  }
});

app.post('/api/time-off', async (req: Request, res: Response) => {
  try {
    const { employee_id, start_date, end_date, leave_type, reason } = req.body;
    await hrService.requestTimeOff(employee_id, { startDate: start_date, endDate: end_date, leaveType: leave_type, reason });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Request failed' });
  }
});

app.get('/api/time-off/balance/:employeeId', async (req: Request, res: Response) => {
  try {
    const balance = await hrService.getTimeOffBalance(req.params.employeeId);
    res.json({ success: true, data: balance });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch balance' });
  }
});

app.get('/health', async (req: Request, res: Response) => {
  res.json({ status: 'healthy', service: 'hr-platform-integration' });
});

const PORT = process.env.PORT || 3071;

app.listen(PORT, () => console.log(`HR Platform Integration Service on port ${PORT}`));

export default app;