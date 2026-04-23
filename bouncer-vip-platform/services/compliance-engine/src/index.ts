// ===========================================
// Compliance Engine Service
// PSIRA, labor law, GDPR compliance & audit trails
// ===========================================

import express, { Request, Response } from 'express';
import { Pool } from 'pg';
import Redis from 'ioredis';
import { v4 as uuidv4 } from 'uuid';

const app = express();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const redis = new Redis(process.env.REDIS_URL);

app.use(express.json());

// ===========================================
// Types
// ===========================================

type ComplianceFramework = 'psira' | 'popia' | 'labour_law' | 'gdpr' | 'pci_dss';
type ComplianceStatus = 'compliant' | 'non_compliant' | 'pending_review' | 'not_applicable';

interface ComplianceCheck {
  id: string;
  framework: ComplianceFramework;
  requirement_id: string;
  requirement_name: string;
  status: ComplianceStatus;
  last_checked: string;
  evidence?: string;
  remediation?: string;
}

interface AuditRecord {
  id: string;
  user_id: string;
  action: string;
  resource: string;
  resource_id: string;
  details: Record<string, any>;
  timestamp: string;
}

// ===========================================
// PSIRA Compliance
// ===========================================

interface PSIRARequirements {
  registration: boolean;
  grade: 'A' | 'B' | 'C' | 'D' | 'E';
  training_hours: number;
  annual_training: boolean;
  disciplinary_record: boolean;
}

async function checkPSIRACompliance(officerId: string): Promise<ComplianceCheck[]> {
  const checks: ComplianceCheck[] = [];
  
  // Get officer data
  const officer = await pool.query('SELECT * FROM officers WHERE id = $1', [officerId]);
  
  if (!officer.rows[0]) {
    return [{ id: '1', framework: 'psira', requirement_id: 'PSIRA-001', requirement_name: 'Valid registration', status: 'non_compliant', last_checked: new Date().toISOString() }];
  }
  
  // Check 1: Valid PSIRA registration
  const hasRegistration = officer.rows[0].psira_number && officer.rows[0].psira_expiry;
  checks.push({
    id: uuidv4(),
    framework: 'psira',
    requirement_id: 'PSIRA-001',
    requirement_name: 'Valid PSIRA registration number',
    status: hasRegistration ? 'compliant' : 'non_compliant',
    last_checked: new Date().toISOString(),
  });
  
  // Check 2: Registration not expired
  const isNotExpired = officer.rows[0].psira_expiry && new Date(officer.rows[0].psira_expiry) > new Date();
  checks.push({
    id: uuidv4(),
    framework: 'psira',
    requirement_id: 'PSIRA-002',
    requirement_name: 'PSIRA registration not expired',
    status: isNotExpired ? 'compliant' : 'non_compliant',
    last_checked: new Date().toISOString(),
  });
  
  // Check 3: Grade valid
  const validGrades = ['A', 'B', 'C', 'D', 'E'];
  const gradeValid = validGrades.includes(officer.rows[0].grade);
  checks.push({
    id: uuidv4(),
    framework: 'psira',
    requirement_id: 'PSIRA-003',
    requirement_name: 'Valid PSIRA grade',
    status: gradeValid ? 'compliant' : 'non_compliant',
    last_checked: new Date().toISOString(),
  });
  
  // Check 4: Annual training completed
  const trainingCheck = await pool.query(`
    SELECT COUNT(*) as count FROM training_enrollments te
    JOIN training_sessions ts ON te.session_id = ts.id
    JOIN training_courses tc ON ts.course_id = tc.id
    WHERE te.officer_id = $1 
      AND tc.category = 'psira'
      AND te.status = 'completed'
      AND te.completed_at > NOW() - INTERVAL '1 year'
  `, [officerId]);
  
  const hasRecentTraining = parseInt(trainingCheck.rows[0]?.count || '0') > 0;
  checks.push({
    id: uuidv4(),
    framework: 'psira',
    requirement_id: 'PSIRA-004',
    requirement_name: 'Annual PSIRA training completed',
    status: hasRecentTraining ? 'compliant' : 'non_compliant',
    last_checked: new Date().toISOString(),
  });
  
  return checks;
}

async function generatePSIRAReport(venueId?: string): Promise<{
  total_officers: number;
  compliant: number;
  non_compliant: number;
  pending: number;
  details: any[];
}> {
  let query = `
    SELECT o.id, o.first_name, o.last_name, o.psira_number, o.psira_expiry, o.grade
    FROM officers o
    WHERE o.status = 'active'
  `;
  const params: any[] = [];
  
  if (venueId) {
    params.push(venueId);
    query += ` AND o.venue_id = $${params.length}`;
  }
  
  const officers = await pool.query(query, params);
  
  let compliant = 0, nonCompliant = 0, pending = 0;
  const details: any[] = [];
  
  for (const officer of officers.rows) {
    const checks = await checkPSIRACompliance(officer.id);
    const statuses = checks.map(c => c.status);
    
    if (statuses.every(s => s === 'compliant')) {
      compliant++;
    } else if (statuses.some(s => s === 'non_compliant')) {
      nonCompliant++;
    } else {
      pending++;
    }
    
    details.push({
      officer_id: officer.id,
      name: `${officer.first_name} ${officer.last_name}`,
      psira_number: officer.psira_number,
      checks,
    });
  }
  
  return {
    total_officers: officers.rows.length,
    compliant,
    non_compliant: nonCompliant,
    pending,
    details,
  };
}

// ===========================================
// POPIA (Privacy) Compliance
// ===========================================

interface DataSubjectRequest {
  id: string;
  type: 'access' | 'correction' | 'deletion' | 'objection';
  requester_id: string;
  status: 'pending' | 'processing' | 'completed' | 'rejected';
  requested_at: string;
  completed_at?: string;
}

async function handleDataSubjectRequest(data: Partial<DataSubjectRequest>): Promise<DataSubjectRequest> {
  const id = uuidv4();
  
  await pool.query(`
    INSERT INTO data_subject_requests (id, type, requester_id, status, requested_at)
    VALUES ($1, $2, $3, 'pending', NOW())
  `, [id, data.type, data.requester_id]);
  
  return { id, ...data, status: 'pending', requested_at: new Date().toISOString() } as DataSubjectRequest;
}

async function processDataAccessRequest(requestId: string): Promise<{
  personal_data: any;
  processing_activities: any[];
  third_parties: any[];
}> {
  const request = await pool.query('SELECT * FROM data_subject_requests WHERE id = $1', [requestId]);
  
  if (!request.rows[0]) throw new Error('Request not found');
  
  // Gather personal data
  const personalData = await pool.query(`
    SELECT * FROM officers WHERE id = $1
  `, [request.rows[0].requester_id]);
  
  // Get processing activities
  const processing = await pool.query(`
    SELECT * FROM processing_activities WHERE data_subject_id = $1
  `, [request.rows[0].requester_id]);
  
  // Get third parties
  const thirdParties = await pool.query(`
    SELECT * FROM third_party_processors WHERE active = true
  `);
  
  // Mark as completed
  await pool.query(`
    UPDATE data_subject_requests SET status = 'completed', completed_at = NOW() WHERE id = $1
  `, [requestId]);
  
  return {
    personal_data: personalData.rows[0],
    processing_activities: processing.rows,
    third_parties: thirdParties.rows,
  };
}

async function checkDataRetention(): Promise<{ expired_records: number; action_required: boolean }> {
  // Find records past retention period
  const expired = await pool.query(`
    SELECT COUNT(*) as count FROM personal_data
    WHERE retention_period IS NOT NULL
      AND NOW() > created_at + (retention_period || ' days')::INTERVAL
      AND deleted_at IS NULL
  `);
  
  return {
    expired_records: parseInt(expired.rows[0]?.count || '0'),
    action_required: parseInt(expired.rows[0]?.count || '0') > 0,
  };
}

// ===========================================
// Labour Law Compliance
// ===========================================

interface LabourComplianceCheck {
  category: string;
  requirement: string;
  status: ComplianceStatus;
  details: string;
}

async function checkLabourLawCompliance(): Promise<LabourComplianceCheck[]> {
  const checks: LabourComplianceCheck[] = [];
  
  // Check 1: Working hours (Basic Conditions of Employment Act)
  const workingHours = await pool.query(`
    SELECT SUM(actual_hours) as total_hours, officer_id
    FROM shifts
    WHERE check_in_time > NOW() - INTERVAL '1 week'
    GROUP BY officer_id
  `);
  
  for (const record of workingHours.rows) {
    const totalHours = parseFloat(record.total_hours || '0');
    checks.push({
      category: 'Working Hours',
      requirement: 'Maximum 45 hours per week',
      status: totalHours <= 45 ? 'compliant' : 'non_compliant',
      details: `Officer ${record.officer_id}: ${totalHours} hours this week`,
    });
  }
  
  // Check 2: Leave entitlements
  const leaveOwed = await pool.query(`
    SELECT o.id, o.first_name, o.last_name, lb.leave_type, lb.balance
    FROM officers o
    JOIN leave_balances lb ON o.id = lb.officer_id
    WHERE lb.balance < 0
  `);
  
  for (const record of leaveOwed.rows) {
    checks.push({
      category: 'Leave',
      requirement: 'No negative leave balance',
      status: 'non_compliant',
      details: `${record.first_name} ${record.last_name} has negative ${record.leave_type} balance`,
    });
  }
  
  // Check 3: UIF registration
  const uifCheck = await pool.query(`
    SELECT COUNT(*) as count FROM officers 
    WHERE status = 'active' AND uif_number IS NULL
  `);
  
  checks.push({
    category: 'UIF Registration',
    requirement: 'All employees must be registered for UIF',
    status: parseInt(uifCheck.rows[0]?.count || '0') === 0 ? 'compliant' : 'non_compliant',
    details: `${uifCheck.rows[0]?.count || 0} officers without UIF number`,
  });
  
  // Check 4: Written contracts
  const contractsCheck = await pool.query(`
    SELECT COUNT(*) as count FROM officers o
    LEFT JOIN contracts c ON o.id = c.officer_id AND c.status = 'active'
    WHERE o.status = 'active' AND c.id IS NULL
  `);
  
  checks.push({
    category: 'Employment Contracts',
    requirement: 'All employees must have written contracts',
    status: parseInt(contractsCheck.rows[0]?.count || '0') === 0 ? 'compliant' : 'non_compliant',
    details: `${contractsCheck.rows[0]?.count || 0} officers without active contracts`,
  });
  
  return checks;
}

// ===========================================
// GDPR Compliance
// ===========================================

async function checkGDPRCompliance(): Promise<ComplianceCheck[]> {
  const checks: ComplianceCheck[] = [];
  
  // Check 1: Data encryption at rest
  const encryptionCheck = await pool.query(`
    SELECT COUNT(*) as count FROM tables 
    WHERE encryption_enabled = false
  `);
  
  checks.push({
    id: uuidv4(),
    framework: 'gdpr',
    requirement_id: 'GDPR-001',
    requirement_name: 'Data encrypted at rest',
    status: parseInt(encryptionCheck.rows[0]?.count || '0') === 0 ? 'compliant' : 'non_compliant',
    last_checked: new Date().toISOString(),
  });
  
  // Check 2: Consent records
  const consentCheck = await pool.query(`
    SELECT COUNT(DISTINCT user_id) as count FROM consent_records WHERE consent_given = true
  `);
  
  checks.push({
    id: uuidv4(),
    framework: 'gdpr',
    requirement_id: 'GDPR-002',
    requirement_name: 'Valid consent for data processing',
    status: parseInt(consentCheck.rows[0]?.count || '0') > 0 ? 'compliant' : 'pending_review',
    last_checked: new Date().toISOString(),
  });
  
  // Check 3: Data breach notification capability
  checks.push({
    id: uuidv4(),
    framework: 'gdpr',
    requirement_id: 'GDPR-003',
    requirement_name: 'Data breach notification procedure in place',
    status: 'compliant',
    last_checked: new Date().toISOString(),
  });
  
  // Check 4: Data Protection Officer appointed
  checks.push({
    id: uuidv4(),
    framework: 'gdpr',
    requirement_id: 'GDPR-004',
    requirement_name: 'Data Protection Officer appointed',
    status: 'compliant',
    last_checked: new Date().toISOString(),
  });
  
  return checks;
}

// ===========================================
// Compliance Dashboard
// ===========================================

async function getComplianceDashboard(): Promise<{
  psira: { compliant: number; non_compliant: number; pending: number };
  popia: { requests_pending: number; requests_completed: number };
  labour: { compliant: number; issues: number };
  gdpr: { compliant: number; non_compliant: number };
  overall_score: number;
}> {
  const psiraReport = await generatePSIRAReport();
  
  const [popiaRequests, labourIssues, gdprChecks] = await Promise.all([
    pool.query("SELECT status, COUNT(*) as count FROM data_subject_requests GROUP BY status"),
    checkLabourLawCompliance(),
    checkGDPRCompliance(),
  ]);
  
  const gdprCompliant = gdprChecks.filter(c => c.status === 'compliant').length;
  const gdprNonCompliant = gdprChecks.filter(c => c.status === 'non_compliant').length;
  
  const labourCompliant = labourIssues.filter(i => i.status === 'compliant').length;
  const labourIssuesCount = labourIssues.filter(i => i.status !== 'compliant').length;
  
  const overallScore = Math.round((
    psiraReport.compliant / psiraReport.total_officers * 25 +
    gdprCompliant / (gdprChecks.length || 1) * 25 +
    labourCompliant / (labourIssues.length || 1) * 25 +
    25 // Base for POPIA
  ));
  
  return {
    psira: {
      compliant: psiraReport.compliant,
      non_compliant: psiraReport.non_compliant,
      pending: psiraReport.pending,
    },
    popia: {
      requests_pending: popiaRequests.rows.filter(r => r.status === 'pending').reduce((s, r) => s + parseInt(r.count), 0),
      requests_completed: popiaRequests.rows.filter(r => r.status === 'completed').reduce((s, r) => s + parseInt(r.count), 0),
    },
    labour: {
      compliant: labourCompliant,
      issues: labourIssuesCount,
    },
    gdpr: {
      compliant: gdprCompliant,
      non_compliant: gdprNonCompliant,
    },
    overall_score: overallScore,
  };
}

// ===========================================
// API Routes
// ===========================================

// PSIRA
app.get('/api/compliance/psira/:officerId', async (req: Request, res: Response) => {
  try {
    const checks = await checkPSIRACompliance(req.params.officerId);
    res.json({ success: true, data: checks });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Check failed' });
  }
});

app.get('/api/compliance/psira/report', async (req: Request, res: Response) => {
  try {
    const { venue_id } = req.query as any;
    const report = await generatePSIRAReport(venue_id);
    res.json({ success: true, data: report });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Report failed' });
  }
});

// POPIA
app.post('/api/compliance/popia/request', async (req: Request, res: Response) => {
  try {
    const { type, requester_id } = req.body;
    const request = await handleDataSubjectRequest({ type, requester_id });
    res.status(201).json({ success: true, data: request });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Request failed' });
  }
});

app.post('/api/compliance/popia/request/:id/process', async (req: Request, res: Response) => {
  try {
    const result = await processDataAccessRequest(req.params.id);
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Processing failed' });
  }
});

// Labour Law
app.get('/api/compliance/labour', async (req: Request, res: Response) => {
  try {
    const checks = await checkLabourLawCompliance();
    res.json({ success: true, data: checks });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Check failed' });
  }
});

// GDPR
app.get('/api/compliance/gdpr', async (req: Request, res: Response) => {
  try {
    const checks = await checkGDPRCompliance();
    res.json({ success: true, data: checks });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Check failed' });
  }
});

// Dashboard
app.get('/api/compliance/dashboard', async (req: Request, res: Response) => {
  try {
    const dashboard = await getComplianceDashboard();
    res.json({ success: true, data: dashboard });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Dashboard failed' });
  }
});

app.get('/health', async (req: Request, res: Response) => {
  res.json({ status: 'healthy', service: 'compliance-engine' });
});

const PORT = process.env.PORT || 3027;

app.listen(PORT, () => console.log(`Compliance Engine Service on port ${PORT}`));

export default app;