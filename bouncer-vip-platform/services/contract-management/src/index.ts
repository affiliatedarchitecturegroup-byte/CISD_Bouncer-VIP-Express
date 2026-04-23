// ===========================================
// Contract Management Service
// E-signatures, templates, contract lifecycle
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
// Contract Types
// ===========================================

type ContractStatus = 'draft' | 'pending_signature' | 'active' | 'expired' | 'terminated';
type ContractType = 'service' | 'retainer' | 'nda' | 'partnership';

interface Contract {
  id: string;
  contract_number: string;
  title: string;
  type: ContractType;
  status: ContractStatus;
  client_id: string;
  terms: string;
  start_date: string;
  end_date: string;
  value: number;
  signatories: Signatory[];
  created_at: string;
  signed_at?: string;
}

interface Signatory {
  id: string;
  name: string;
  email: string;
  role: 'client' | 'company' | 'witness';
  signed: boolean;
  signed_at?: string;
  signature_data?: string;
}

// ===========================================
// Contract Templates
// ===========================================

interface ContractTemplate {
  id: string;
  name: string;
  type: ContractType;
  content: string;
  variables: string[];
}

const TEMPLATES: ContractTemplate[] = [
  {
    id: 'service_agreement',
    name: 'Service Agreement',
    type: 'service',
    content: `
SERVICE AGREEMENT

This Service Agreement ("Agreement") is entered into between:

CLIENT: {{client_name}}
Address: {{client_address}}
("Client")

and

BOUNCER VIP (Pty) Ltd
("Service Provider")

1. SERVICES
The Service Provider agrees to provide security services at {{venue_address}} as detailed in Schedule A.

2. TERM
This Agreement commences on {{start_date}} and ends on {{end_date}}.

3. PAYMENT
The Client agrees to pay R{{monthly_value}} per month for services rendered.

4. TERMINATION
Either party may terminate with {{notice_period}} days written notice.

SIGNATURES:

Client: ____________________ Date: __________

Service Provider: ____________________ Date: __________
    `,
    variables: ['client_name', 'client_address', 'venue_address', 'start_date', 'end_date', 'monthly_value', 'notice_period'],
  },
  {
    id: 'retainer_agreement',
    name: 'Retainer Agreement',
    type: 'retainer',
    content: `
RETAINER AGREEMENT

This Retainer Agreement is between:
{{client_name}} ("Client")
and
BOUNCER VIP (Pty) Ltd ("Provider")

1. RETAINER FEE
Client agrees to pay R{{retainer_amount}} monthly retainer fee.

2. SERVICES
Provider guarantees {{min_officers}} officers available per month.

3. TERM
{{start_date}} to {{end_date}}
    `,
    variables: ['client_name', 'retainer_amount', 'min_officers', 'start_date', 'end_date'],
  },
  {
    id: 'nda',
    name: 'Non-Disclosure Agreement',
    type: 'nda',
    content: `
NON-DISCLOSURE AGREEMENT

This NDA is between {{party_a}} and {{party_b}}.

Both parties agree to keep confidential all proprietary information.
    `,
    variables: ['party_a', 'party_b'],
  },
];

// ===========================================
// Contract CRUD
// ===========================================

async function generateContractNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `CON-${year}-`;
  
  const result = await pool.query(`
    SELECT contract_number FROM contracts 
    WHERE contract_number LIKE $1
    ORDER BY created_at DESC LIMIT 1
  `, [`${prefix}%`]);
  
  if (!result.rows[0]) return `${prefix}0001`;
  
  const lastNum = parseInt(result.rows[0].contract_number.replace(prefix, ''));
  return `${prefix}${String(lastNum + 1).padStart(4, '0')}`;
}

async function createContract(data: {
  title: string;
  type: ContractType;
  template_id?: string;
  client_id: string;
  terms?: string;
  start_date: string;
  end_date: string;
  value: number;
  signatories: { name: string; email: string; role: string }[];
}): Promise<Contract> {
  const id = uuidv4();
  const contractNumber = await generateContractNumber();
  
  let terms = data.terms || '';
  if (data.template_id) {
    const template = TEMPLATES.find(t => t.id === data.template_id);
    if (template) terms = template.content;
  }
  
  const [contract] = await pool.query(`
    INSERT INTO contracts (id, contract_number, title, type, client_id, terms, start_date, end_date, value, status)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'draft')
    RETURNING *
  `, [id, contractNumber, data.title, data.type, data.client_id, terms, data.start_date, data.end_date, data.value]);
  
  // Add signatories
  for (const sig of data.signatories) {
    await pool.query(`
      INSERT INTO contract_signatories (id, contract_id, name, email, role)
      VALUES ($1, $2, $3, $4, $5)
    `, [uuidv4(), id, sig.name, sig.email, sig.role]);
  }
  
  return contract;
}

async function getContracts(filters?: {
  client_id?: string;
  status?: ContractStatus;
  type?: ContractType;
}): Promise<Contract[]> {
  let query = 'SELECT * FROM contracts WHERE deleted_at IS NULL';
  const params: any[] = [];
  
  if (filters?.client_id) {
    params.push(filters.client_id);
    query += ` AND client_id = $${params.length}`;
  }
  if (filters?.status) {
    params.push(filters.status);
    query += ` AND status = $${params.length}`;
  }
  if (filters?.type) {
    params.push(filters.type);
    query += ` AND type = $${params.length}`;
  }
  
  query += ' ORDER BY created_at DESC';
  const result = await pool.query(query, params);
  
  const contracts: Contract[] = [];
  for (const row of result.rows) {
    const signatories = await pool.query(
      'SELECT * FROM contract_signatories WHERE contract_id = $1',
      [row.id]
    );
    contracts.push({ ...row, signatories: signatories.rows });
  }
  
  return contracts;
}

async function getContractById(id: string): Promise<Contract | null> {
  const result = await pool.query('SELECT * FROM contracts WHERE id = $1', [id]);
  if (!result.rows[0]) return null;
  
  const signatories = await pool.query(
    'SELECT * FROM contract_signatories WHERE contract_id = $1',
    [id]
  );
  
  return { ...result.rows[0], signatories: signatories.rows };
}

async function updateContractStatus(id: string, status: ContractStatus): Promise<void> {
  await pool.query(`
    UPDATE contracts SET status = $1, updated_at = NOW() WHERE id = $2
  `, [status, id]);
}

// ===========================================
// E-Signature
// ===========================================

async function requestSignature(contractId: string, signatoryIds: string[]): Promise<void> {
  await updateContractStatus(contractId, 'pending_signature');
  
  for (const sigId of signatoryIds) {
    await pool.query(`
      UPDATE contract_signatories SET signed = false WHERE id = $1
    `, [sigId]);
    
    // Send signature request email
    // await emailService.sendSignRequest(sigId);
  }
}

async function signContract(
  contractId: string,
  signatoryId: string,
  signatureData: string,
  ipAddress: string
): Promise<void> {
  await pool.query(`
    UPDATE contract_signatories 
    SET signed = true, signed_at = NOW(), signature_data = $1, ip_address = $2
    WHERE id = $3
  `, [signatureData, ipAddress, signatoryId]);
  
  // Check if all signed
  const pending = await pool.query(`
    SELECT COUNT(*) as count FROM contract_signatories 
    WHERE contract_id = $1 AND signed = false
  `, [contractId]);
  
  if (parseInt(pending.rows[0]?.count || '0') === 0) {
    await updateContractStatus(contractId, 'active');
    await pool.query(`
      UPDATE contracts SET signed_at = NOW() WHERE id = $1
    `, [contractId]);
  }
}

// ===========================================
// Contract Expiry Monitoring
// ===========================================

async function getExpiringContracts(daysAhead: number = 30): Promise<Contract[]> {
  const result = await pool.query(`
    SELECT * FROM contracts 
    WHERE status = 'active' 
      AND end_date BETWEEN NOW() AND NOW() + INTERVAL '1 day' * $1
    ORDER BY end_date
  `, [daysAhead]);
  return result.rows;
}

async function renewContract(
  contractId: string,
  newStartDate: string,
  newEndDate: string,
  newValue?: number
): Promise<void> {
  await pool.query(`
    UPDATE contracts 
    SET start_date = $1, end_date = $2, value = COALESCE($3, value), status = 'active', updated_at = NOW()
    WHERE id = $4
  `, [newStartDate, newEndDate, newValue, contractId]);
}

async function terminateContract(contractId: string, reason: string): Promise<void> {
  await pool.query(`
    UPDATE contracts SET status = 'terminated', termination_reason = $1, updated_at = NOW()
    WHERE id = $2
  `, [reason, contractId]);
}

// ===========================================
// API Routes
// ===========================================

app.post('/api/contracts', async (req: Request, res: Response) => {
  try {
    const contract = await createContract(req.body);
    res.status(201).json({ success: true, data: contract });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to create contract' });
  }
});

app.get('/api/contracts', async (req: Request, res: Response) => {
  try {
    const contracts = await getContracts(req.query as any);
    res.json({ success: true, data: contracts });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch contracts' });
  }
});

app.get('/api/contracts/:id', async (req: Request, res: Response) => {
  try {
    const contract = await getContractById(req.params.id);
    if (!contract) return res.status(404).json({ error: 'Contract not found' });
    res.json({ success: true, data: contract });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch contract' });
  }
});

app.post('/api/contracts/:id/request-signature', async (req: Request, res: Response) => {
  try {
    const { signatory_ids } = req.body;
    await requestSignature(req.params.id, signatory_ids);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to request signature' });
  }
});

app.post('/api/contracts/:id/sign', async (req: Request, res: Response) => {
  try {
    const { signatory_id, signature_data } = req.body;
    await signContract(req.params.id, signatory_id, signature_data, req.ip || '');
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to sign' });
  }
});

app.post('/api/contracts/:id/renew', async (req: Request, res: Response) => {
  try {
    const { start_date, end_date, value } = req.body;
    await renewContract(req.params.id, start_date, end_date, value);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to renew' });
  }
});

app.post('/api/contracts/:id/terminate', async (req: Request, res: Response) => {
  try {
    const { reason } = req.body;
    await terminateContract(req.params.id, reason);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to terminate' });
  }
});

app.get('/api/templates', async (req: Request, res: Response) => {
  res.json({ success: true, data: TEMPLATES });
});

app.get('/api/expiring', async (req: Request, res: Response) => {
  try {
    const { days } = req.query;
    const contracts = await getExpiringContracts(parseInt(days as any) || 30);
    res.json({ success: true, data: contracts });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch expiring contracts' });
  }
});

app.get('/health', async (req: Request, res: Response) => {
  res.json({ status: 'healthy', service: 'contract-management' });
});

const PORT = process.env.PORT || 3051;

app.listen(PORT, () => console.log(`Contract Management Service on port ${PORT}`));

export default app;