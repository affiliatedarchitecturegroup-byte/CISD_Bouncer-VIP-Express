// ===========================================
// Accounting Integration Service
// Sage, QuickBooks sync
// ===========================================

import express, { Request, Response } from 'express';
import { Pool } from 'pg';
import Redis from 'ioredis';
import { v4 as uuidv4 } from 'uuid';
import axios from 'axios';

const app = express();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const redis = new Redis(process.env.REDIS_URL);

app.use(express.json());

// ===========================================
// Types
// ===========================================

type Provider = 'sage' | 'quickbooks' | 'xero';
type SyncStatus = 'pending' | 'synced' | 'failed';

interface SyncLog {
  id: string;
  provider: Provider;
  entity_type: string;
  entity_id: string;
  direction: 'push' | 'pull';
  status: SyncStatus;
  error?: string;
  synced_at?: string;
}

// ===========================================
// Sage Integration
// ===========================================

class SageIntegration {
  private baseUrl = 'https://api.sage.com';
  private clientId: string;
  private clientSecret: string;
  private accessToken?: string;

  constructor() {
    this.clientId = process.env.SAGE_CLIENT_ID || '';
    this.clientSecret = process.env.SAGE_CLIENT_SECRET || '';
  }

  private async authenticate(): Promise<void> {
    // OAuth2 authentication
    const response = await axios.post(`${this.baseUrl}/auth/token`, {
      grant_type: 'client_credentials',
      client_id: this.clientId,
      client_secret: this.clientSecret,
    });
    this.accessToken = response.data.access_token;
  }

  async createInvoice(invoice: any): Promise<{ sage_id: string }> {
    await this.authenticate();
    
    const response = await axios.post(
      `${this.baseUrl}/accounting/invoices`,
      {
        invoice_number: invoice.invoiceNumber,
        contact: { name: invoice.clientName },
        lines: invoice.items.map((item: any) => ({
          description: item.description,
          quantity: item.quantity,
          unit_amount: item.rate,
        })),
        due_date: invoice.dueDate,
        total: invoice.totalAmount,
      },
      { headers: { Authorization: `Bearer ${this.accessToken}` } }
    );

    return { sage_id: response.data.id };
  }

  async createPayment(payment: any): Promise<{ sage_id: string }> {
    await this.authenticate();
    
    const response = await axios.post(
      `${this.baseUrl}/accounting/payments`,
      {
        date: payment.date,
        reference: payment.reference,
        invoice: { id: payment.invoiceId },
        amount: payment.amount,
      },
      { headers: { Authorization: `Bearer ${this.accessToken}` } }
    );

    return { sage_id: response.data.id };
  }

  async getContacts(): Promise<any[]> {
    await this.authenticate();
    
    const response = await axios.get(
      `${this.baseUrl}/accounting/contacts`,
      { headers: { Authorization: `Bearer ${this.accessToken}` } }
    );

    return response.data.items;
  }

  async syncContact(contact: any): Promise<any> {
    await this.authenticate();
    
    const response = await axios.post(
      `${this.baseUrl}/accounting/contacts`,
      {
        name: contact.name,
        email: contact.email,
        phone: contact.phone,
      },
      { headers: { Authorization: `Bearer ${this.accessToken}` } }
    );

    return response.data;
  }
}

// ===========================================
// QuickBooks Integration
// ===========================================

class QuickBooksIntegration {
  private baseUrl = 'https://quickbooks.api.intuit.com';
  private realmId: string;
  private accessToken?: string;

  constructor() {
    this.realmId = process.env.QB_REALM_ID || '';
  }

  private async authenticate(): Promise<void> {
    // OAuth2 with refresh token logic
    const response = await axios.post('https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer', {
      grant_type: 'refresh_token',
      refresh_token: process.env.QB_REFRESH_TOKEN,
      client_id: process.env.QB_CLIENT_ID,
      client_secret: process.env.QB_CLIENT_SECRET,
    });
    this.accessToken = response.data.access_token;
  }

  async createInvoice(invoice: any): Promise<{ qb_id: string }> {
    await this.authenticate();
    
    const response = await axios.post(
      `${this.baseUrl}/v3/company/${this.realmId}/invoice`,
      {
        Line: invoice.items.map((item: any, index: number) => ({
          Amount: item.amount,
          DetailType: 'SalesItemLineDetail',
          SalesItemLineDetail: {
            ItemRef: { value: '1' },
            Qty: item.quantity,
            UnitPrice: item.rate,
          },
          Description: item.description,
        })),
        CustomerRef: { value: invoice.clientId },
        DueDate: invoice.dueDate,
      },
      {
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
      }
    );

    return { qb_id: response.data.Invoice.Id };
  }

  async createCustomer(customer: any): Promise<{ qb_id: string }> {
    await this.authenticate();
    
    const response = await axios.post(
      `${this.baseUrl}/v3/company/${this.realmId}/customer`,
      {
        DisplayName: customer.name,
        PrimaryEmailAddr: { Address: customer.email },
        PrimaryPhone: { FreeFormNumber: customer.phone },
      },
      {
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
      }
    );

    return { qb_id: response.data.Customer.Id };
  }

  async getCustomers(): Promise<any[]> {
    await this.authenticate();
    
    const response = await axios.get(
      `${this.baseUrl}/v3/company/${this.realmId}/query`,
      {
        params: { query: 'SELECT * FROM Customer MAXRESULTS 1000' },
        headers: { Authorization: `Bearer ${this.accessToken}` },
      }
    );

    return response.data.QueryResponse?.Customer || [];
  }
}

// ===========================================
// Sync Engine
// ===========================================

class SyncEngine {
  private sage: SageIntegration;
  private quickbooks: QuickBooksIntegration;

  constructor() {
    this.sage = new SageIntegration();
    this.quickbooks = new QuickBooksIntegration();
  }

  async syncInvoice(invoice: any, provider: Provider): Promise<void> {
    let externalId: string;
    
    try {
      if (provider === 'sage') {
        const result = await this.sage.createInvoice(invoice);
        externalId = result.sage_id;
      } else if (provider === 'quickbooks') {
        const result = await this.quickbooks.createInvoice(invoice);
        externalId = result.qb_id;
      }

      await this.logSync(provider, 'invoice', invoice.id, 'push', 'synced', externalId);
      await pool.query(`
        UPDATE invoices SET external_id = $1, external_system = $2, synced_at = NOW()
        WHERE id = $3
      `, [externalId, provider, invoice.id]);
    } catch (error) {
      await this.logSync(provider, 'invoice', invoice.id, 'push', 'failed', undefined, (error as Error).message);
      throw error;
    }
  }

  async syncPayment(payment: any, provider: Provider): Promise<void> {
    try {
      if (provider === 'sage') {
        await this.sage.createPayment(payment);
      }
      // QuickBooks payment would go here
      
      await this.logSync(provider, 'payment', payment.id, 'push', 'synced');
      await pool.query(`
        UPDATE payments SET synced = true, synced_at = NOW() WHERE id = $1
      `, [payment.id]);
    } catch (error) {
      await this.logSync(provider, 'payment', payment.id, 'push', 'failed', undefined, (error as Error).message);
    }
  }

  async pullContacts(provider: Provider): Promise<void> {
    try {
      let contacts: any[] = [];
      
      if (provider === 'sage') {
        contacts = await this.sage.getContacts();
      } else if (provider === 'quickbooks') {
        contacts = await this.quickbooks.getCustomers();
      }

      for (const contact of contacts) {
        // Check if exists
        const existing = await pool.query(
          'SELECT id FROM contacts WHERE external_id = $1 AND external_system = $2',
          [contact.id, provider]
        );

        if (existing.rows.length === 0) {
          await pool.query(`
            INSERT INTO contacts (id, name, email, phone, external_id, external_system, synced_at)
            VALUES ($1, $2, $3, $4, $5, $6, NOW())
          `, [uuidv4(), contact.name, contact.email, contact.phone, contact.id, provider]);
        }
      }

      await this.logSync(provider, 'contact', 'all', 'pull', 'synced');
    } catch (error) {
      await this.logSync(provider, 'contact', 'all', 'pull', 'failed', undefined, (error as Error).message);
    }
  }

  private async logSync(
    provider: Provider,
    entityType: string,
    entityId: string,
    direction: 'push' | 'pull',
    status: SyncStatus,
    externalId?: string,
    error?: string
  ): Promise<void> {
    await pool.query(`
      INSERT INTO sync_logs (id, provider, entity_type, entity_id, external_id, direction, status, error, synced_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
    `, [uuidv4(), provider, entityType, entityId, externalId, direction, status, error]);
  }
}

const syncEngine = new SyncEngine();

// ===========================================
// API Routes
// ===========================================

app.post('/api/sync/invoice/:provider', async (req: Request, res: Response) => {
  try {
    const { provider } = req.params;
    const { invoice_id } = req.body;
    
    const invoice = await pool.query('SELECT * FROM invoices WHERE id = $1', [invoice_id]);
    
    if (!invoice.rows[0]) {
      return res.status(404).json({ error: 'Invoice not found' });
    }
    
    await syncEngine.syncInvoice(invoice.rows[0], provider as Provider);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Sync failed' });
  }
});

app.post('/api/sync/payment/:provider', async (req: Request, res: Response) => {
  try {
    const { provider } = req.params;
    const { payment_id } = req.body;
    
    const payment = await pool.query('SELECT * FROM payments WHERE id = $1', [payment_id]);
    
    if (!payment.rows[0]) {
      return res.status(404).json({ error: 'Payment not found' });
    }
    
    await syncEngine.syncPayment(payment.rows[0], provider as Provider);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Sync failed' });
  }
});

app.post('/api/sync/contacts/:provider', async (req: Request, res: Response) => {
  try {
    await syncEngine.pullContacts(req.params.provider as Provider);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Sync failed' });
  }
});

app.get('/api/sync/status', async (req: Request, res: Response) => {
  try {
    const logs = await pool.query(`
      SELECT * FROM sync_logs ORDER BY synced_at DESC LIMIT 50
    `);
    res.json({ success: true, data: logs.rows });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch status' });
  }
});

app.get('/health', async (req: Request, res: Response) => {
  res.json({ status: 'healthy', service: 'accounting-integration' });
});

const PORT = process.env.PORT || 3070;

app.listen(PORT, () => console.log(`Accounting Integration Service on port ${PORT}`));

export default app;