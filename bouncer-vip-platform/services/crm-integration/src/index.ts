// ===========================================
// CRM Integration Service
// Salesforce sync
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

type CRMProvider = 'salesforce' | 'hubspot';

interface CRMContact {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  company?: string;
  title?: string;
  source: string;
}

interface CRMOpportunity {
  id: string;
  name: string;
  stage: string;
  amount: number;
  probability: number;
  closeDate: string;
  contactId: string;
}

// ===========================================
// Salesforce Integration
// ===========================================

class SalesforceIntegration {
  private baseUrl = 'https://login.salesforce.com/services/oauth2';
  private clientId: string;
  private clientSecret: string;
  private accessToken?: string;
  private instanceUrl?: string;

  constructor() {
    this.clientId = process.env.SF_CLIENT_ID || '';
    this.clientSecret = process.env.SF_CLIENT_SECRET || '';
  }

  private async authenticate(): Promise<void> {
    const response = await axios.post(`${this.baseUrl}/token`, 
      new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: this.clientId,
        client_secret: this.clientSecret,
      })
    );

    this.accessToken = response.data.access_token;
    this.instanceUrl = response.data.instance_url;
  }

  private async request(endpoint: string, method: string = 'GET', data?: any): Promise<any> {
    await this.authenticate();

    const response = await axios({
      method,
      url: `${this.instanceUrl}/services/data/v58.0/${endpoint}`,
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
      data,
    });

    return response.data;
  }

  async createContact(contact: CRMContact): Promise<{ sf_id: string }> {
    const result = await this.request('sobjects/Contact', 'POST', {
      FirstName: contact.firstName,
      LastName: contact.lastName,
      Email: contact.email,
      Phone: contact.phone,
      Title: contact.title,
    });

    return { sf_id: result.id };
  }

  async updateContact(id: string, updates: any): Promise<void> {
    await this.request(`sobjects/Contact/${id}`, 'PATCH', updates);
  }

  async getContacts(): Promise<CRMContact[]> {
    const result = await this.request('query?q=SELECT+Id,FirstName,LastName,Email,Phone,Title+FROM+Contact');
    
    return result.records.map((r: any) => ({
      id: r.Id,
      firstName: r.FirstName,
      lastName: r.LastName,
      email: r.Email,
      phone: r.Phone,
      title: r.Title,
      source: 'salesforce',
    }));
  }

  async createOpportunity(opportunity: CRMOpportunity): Promise<{ sf_id: string }> {
    const result = await this.request('sobjects/Opportunity', 'POST', {
      Name: opportunity.name,
      StageName: opportunity.stage,
      Amount: opportunity.amount,
      Probability: opportunity.probability,
      CloseDate: opportunity.closeDate,
    });

    return { sf_id: result.id };
  }

  async getOpportunities(): Promise<CRMOpportunity[]> {
    const result = await this.request('query?q=SELECT+Id,Name,StageName,Amount,Probability,CloseDate+FROM+Opportunity');
    
    return result.records.map((r: any) => ({
      id: r.Id,
      name: r.Name,
      stage: r.StageName,
      amount: r.Amount,
      probability: r.Probability,
      closeDate: r.CloseDate,
    }));
  }
}

// ===========================================
// HubSpot Integration
// ===========================================

class HubSpotIntegration {
  private baseUrl = 'https://api.hubapi.com';
  private apiKey: string;

  constructor() {
    this.apiKey = process.env.HUBSPOT_API_KEY || '';
  }

  private getHeaders() {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
    };
  }

  async createContact(contact: CRMContact): Promise<{ hs_id: string }> {
    const response = await axios.post(
      `${this.baseUrl}/crm/v3/objects/contacts`,
      {
        properties: {
          firstname: contact.firstName,
          lastname: contact.lastName,
          email: contact.email,
          phone: contact.phone,
          jobtitle: contact.title,
        },
      },
      { headers: this.getHeaders() }
    );

    return { hs_id: response.data.id };
  }

  async getContacts(): Promise<CRMContact[]> {
    const response = await axios.get(
      `${this.baseUrl}/crm/v3/objects/contacts?limit=100`,
      { headers: this.getHeaders() }
    );

    return response.data.results.map((r: any) => ({
      id: r.id,
      firstName: r.properties.firstname,
      lastName: r.properties.lastname,
      email: r.properties.email,
      phone: r.properties.phone,
      title: r.properties.jobtitle,
      source: 'hubspot',
    }));
  }

  async createDeal(deal: any): Promise<{ hs_id: string }> {
    const response = await axios.post(
      `${this.baseUrl}/crm/v3/objects/deals`,
      {
        properties: {
          dealname: deal.name,
          dealstage: deal.stage,
          amount: deal.amount,
        },
      },
      { headers: this.getHeaders() }
    );

    return { hs_id: response.data.id };
  }
}

// ===========================================
// CRM Service
// ===========================================

class CRMService {
  private salesforce: SalesforceIntegration;
  private hubspot: HubSpotIntegration;

  constructor() {
    this.salesforce = new SalesforceIntegration();
    this.hubspot = new HubSpotIntegration();
  }

  async syncContact(contact: CRMContact, provider: CRMProvider): Promise<{ external_id: string }> {
    let result: { sf_id?: string; hs_id?: string };

    if (provider === 'salesforce') {
      result = await this.salesforce.createContact(contact);
    } else if (provider === 'hubspot') {
      result = await this.hubspot.createContact(contact);
    }

    const externalId = (result as any).sf_id || (result as any).hs_id;
    
    // Log sync
    await pool.query(`
      INSERT INTO crm_sync_logs (id, provider, entity_type, local_id, external_id, status, synced_at)
      VALUES ($1, $2, 'contact', $3, $4, 'synced', NOW())
    `, [uuidv4(), provider, contact.id, externalId]);

    return { external_id: externalId };
  }

  async pullContacts(provider: CRMProvider): Promise<CRMContact[]> {
    if (provider === 'salesforce') {
      return this.salesforce.getContacts();
    } else if (provider === 'hubspot') {
      return this.hubspot.getContacts();
    }
    return [];
  }

  async importContacts(provider: CRMProvider): Promise<{ imported: number; errors: number }> {
    const contacts = await this.pullContacts(provider);
    let imported = 0, errors = 0;

    for (const contact of contacts) {
      try {
        const existing = await pool.query(
          'SELECT id FROM users WHERE email = $1',
          [contact.email]
        );

        if (existing.rows.length === 0) {
          await pool.query(`
            INSERT INTO users (id, first_name, last_name, email, phone, source, synced_at)
            VALUES ($1, $2, $3, $4, $5, $6, NOW())
          `, [uuidv4(), contact.firstName, contact.lastName, contact.email, contact.phone, provider]);
          imported++;
        }
      } catch (error) {
        errors++;
      }
    }

    return { imported, errors };
  }

  async syncOpportunity(opportunity: any, provider: CRMProvider): Promise<void> {
    if (provider === 'salesforce') {
      await this.salesforce.createOpportunity(opportunity);
    } else if (provider === 'hubspot') {
      await this.hubspot.createDeal(opportunity);
    }
  }

  async createLeadFromBooking(booking: any): Promise<void> {
    // Create CRM lead from new booking
    await pool.query(`
      INSERT INTO crm_leads (id, source, source_id, name, email, company, status, created_at)
      VALUES ($1, 'booking', $2, $3, $4, $5, 'new', NOW())
    `, [uuidv4(), booking.id, booking.venueName, booking.clientEmail, booking.clientCompany]);
  }
}

const crmService = new CRMService();

// ===========================================
// API Routes
// ===========================================

app.post('/api/sync/contact', async (req: Request, res: Response) => {
  try {
    const { contact, provider } = req.body;
    const result = await crmService.syncContact(contact, provider);
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Sync failed' });
  }
});

app.post('/api/import/contacts', async (req: Request, res: Response) => {
  try {
    const { provider } = req.body;
    const result = await crmService.importContacts(provider);
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Import failed' });
  }
});

app.get('/api/contacts', async (req: Request, res: Response) => {
  try {
    const { provider } = req.query;
    const contacts = await crmService.pullContacts(provider as CRMProvider);
    res.json({ success: true, data: contacts });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch contacts' });
  }
});

app.post('/api/lead/from-booking', async (req: Request, res: Response) => {
  try {
    const { booking } = req.body;
    await crmService.createLeadFromBooking(booking);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to create lead' });
  }
});

app.get('/health', async (req: Request, res: Response) => {
  res.json({ status: 'healthy', service: 'crm-integration' });
});

const PORT = process.env.PORT || 3073;

app.listen(PORT, () => console.log(`CRM Integration Service on port ${PORT}`));

export default app;