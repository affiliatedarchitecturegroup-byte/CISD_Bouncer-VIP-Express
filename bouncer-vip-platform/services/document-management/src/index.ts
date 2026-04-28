// ===========================================
// Document Management Service
// Secure storage, e-signatures & file management
// ===========================================

import express, { Request, Response } from 'express';
import { Pool } from 'pg';
import Redis from 'ioredis';
import { v4 as uuidv4 } from 'uuid';
import * as crypto from 'crypto';
import * as fs from 'fs';

const app = express();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const redis = new Redis(process.env.REDIS_URL);

app.use(express.json());

// ===========================================
// Document Types
// ===========================================

type DocumentCategory = 'contract' | 'id_document' | 'certification' | 'policy' | 'incident_report' | 'other';
type DocumentStatus = 'draft' | 'pending_signature' | 'signed' | 'expired' | 'archived';
type AccessLevel = 'private' | 'team' | 'department' | 'company';

interface Document {
  id: string;
  name: string;
  category: DocumentCategory;
  description?: string;
  file_url: string;
  file_hash: string;
  file_size: number;
  mime_type: string;
  owner_id: string;
  status: DocumentStatus;
  access_level: AccessLevel;
  department_id?: string;
  expires_at?: string;
  created_at: string;
}

interface Signature {
  id: string;
  document_id: string;
  signer_id: string;
  signer_name: string;
  signer_email: string;
  signed_at?: string;
  signature_data: string;
  ip_address?: string;
}

// ===========================================
// Document CRUD
// ===========================================

async function uploadDocument(data: {
  name: string;
  category: DocumentCategory;
  description?: string;
  file_buffer: Buffer;
  mime_type: string;
  owner_id: string;
  access_level: AccessLevel;
  department_id?: string;
}): Promise<Document> {
  const id = uuidv4();
  const fileHash = crypto.createHash('sha256').update(data.file_buffer).digest('hex');
  const fileSize = data.file_buffer.length;
  const filePath = `/documents/${id}/${data.name}`;
  
  // In production, upload to S3
  // await s3.putObject({ Bucket: BUCKET, Key: filePath, Body: data.file_buffer });
  
  const [document] = await pool.query(`
    INSERT INTO documents (id, name, category, description, file_url, file_hash, file_size, mime_type, owner_id, status, access_level, department_id)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'draft', $10, $11)
    RETURNING *
  `, [id, data.name, data.category, data.description, filePath, fileHash, fileSize, data.mime_type, data.owner_id, data.access_level, data.department_id]);
  
  return document;
}

async function getDocuments(filters?: {
  category?: string;
  owner_id?: string;
  status?: string;
  access_level?: AccessLevel;
}): Promise<Document[]> {
  let query = `
    SELECT d.*, o.first_name || ' ' || o.last_name as owner_name
    FROM documents d
    LEFT JOIN officers o ON d.owner_id = o.id
    WHERE d.deleted_at IS NULL
  `;
  const params: any[] = [];
  
  if (filters?.category) {
    params.push(filters.category);
    query += ` AND d.category = $${params.length}`;
  }
  if (filters?.owner_id) {
    params.push(filters.owner_id);
    query += ` AND d.owner_id = $${params.length}`;
  }
  if (filters?.status) {
    params.push(filters.status);
    query += ` AND d.status = $${params.length}`;
  }
  if (filters?.access_level) {
    params.push(filters.access_level);
    query += ` AND d.access_level = $${params.length}`;
  }
  
  query += ' ORDER BY d.created_at DESC';
  const result = await pool.query(query, params);
  return result.rows;
}

async function getDocumentById(id: string): Promise<Document | null> {
  const result = await pool.query('SELECT * FROM documents WHERE id = $1 AND deleted_at IS NULL', [id]);
  return result.rows[0] || null;
}

async function downloadDocument(id: string): Promise<Buffer | null> {
  const doc = await getDocumentById(id);
  if (!doc) return null;
  
  // In production, download from S3
  // const response = await s3.getObject({ Bucket: BUCKET, Key: doc.file_url });
  // return response.Body as Buffer;
  
  return Buffer.from('placeholder');
}

async function deleteDocument(id: string): Promise<void> {
  await pool.query('UPDATE documents SET deleted_at = NOW() WHERE id = $1', [id]);
}

// ===========================================
// Versioning
// ===========================================

interface DocumentVersion {
  id: string;
  document_id: string;
  version: number;
  file_url: string;
  file_hash: string;
  changed_by: string;
  change_reason?: string;
  created_at: string;
}

async function createVersion(documentId: string, newFileBuffer: Buffer, changedBy: string, reason?: string): Promise<DocumentVersion> {
  const id = uuidv4();
  const fileHash = crypto.createHash('sha256').update(newFileBuffer).digest('hex');
  
  // Get current version
  const current = await pool.query(
    'SELECT MAX(version) as max_version FROM document_versions WHERE document_id = $1',
    [documentId]
  );
  const version = (current.rows[0]?.max_version || 0) + 1;
  
  const [newVersion] = await pool.query(`
    INSERT INTO document_versions (id, document_id, version, file_hash, changed_by, change_reason)
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING *
  `, [id, documentId, version, fileHash, changedBy, reason]);
  
  // Update main document
  await pool.query(`
    UPDATE documents SET file_hash = $1, updated_at = NOW() WHERE id = $2
  `, [fileHash, documentId]);
  
  return newVersion;
}

async function getVersionHistory(documentId: string): Promise<DocumentVersion[]> {
  const result = await pool.query(`
    SELECT v.*, o.first_name || ' ' || o.last_name as changed_by_name
    FROM document_versions v
    LEFT JOIN officers o ON v.changed_by = o.id
    WHERE v.document_id = $1
    ORDER BY v.version DESC
  `, [documentId]);
  return result.rows;
}

// ===========================================
// E-Signatures
// ===========================================

async function requestSignature(documentId: string, signers: { id: string; name: string; email: string }[]): Promise<void> {
  // Update document status
  await pool.query(`
    UPDATE documents SET status = 'pending_signature', updated_at = NOW() WHERE id = $1
  `, [documentId]);
  
  for (const signer of signers) {
    await pool.query(`
      INSERT INTO document_signatures (id, document_id, signer_id, signer_name, signer_email)
      VALUES ($1, $2, $3, $4, $5)
    `, [uuidv4(), documentId, signer.id, signer.name, signer.email]);
    
    // Send notification email
    // await emailService.sendSignatureRequest(signer.email, documentId);
  }
}

async function signDocument(documentId: string, signerId: string, signatureData: string, ipAddress: string): Promise<Signature> {
  const [existing] = await pool.query(`
    SELECT * FROM document_signatures WHERE document_id = $1 AND signer_id = $2
  `, [documentId, signerId]);
  
  if (!existing) throw new Error('Signature not requested');
  if (existing.signed_at) throw new Error('Already signed');
  
  const [signature] = await pool.query(`
    UPDATE document_signatures 
    SET signed_at = NOW(), signature_data = $1, ip_address = $2
    WHERE document_id = $3 AND signer_id = $4
    RETURNING *
  `, [signatureData, ipAddress, documentId, signerId]);
  
  // Check if all signed
  const pending = await pool.query(`
    SELECT COUNT(*) as count FROM document_signatures 
    WHERE document_id = $1 AND signed_at IS NULL
  `, [documentId]);
  
  if (parseInt(pending.rows[0]?.count) === 0) {
    await pool.query(`
      UPDATE documents SET status = 'signed', updated_at = NOW() WHERE id = $1
    `, [documentId]);
  }
  
  return signature;
}

async function getSignatureStatus(documentId: string): Promise<{
  total_signers: number;
  signed_count: number;
  signers: { name: string; signed_at?: string; email: string }[];
}> {
  const signers = await pool.query(`
    SELECT signer_name, signer_email, signed_at FROM document_signatures WHERE document_id = $1
  `, [documentId]);
  
  return {
    total_signers: signers.rows.length,
    signed_count: signers.rows.filter(s => s.signed_at).length,
    signers: signers.rows,
  };
}

// ===========================================
// Access Control
// ===========================================

async function grantAccess(documentId: string, userId: string, accessLevel: AccessLevel): Promise<void> {
  await pool.query(`
    INSERT INTO document_access (id, document_id, user_id, access_level)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (document_id, user_id) DO UPDATE SET access_level = $4
  `, [uuidv4(), documentId, userId, accessLevel]);
}

async function revokeAccess(documentId: string, userId: string): Promise<void> {
  await pool.query(`
    DELETE FROM document_access WHERE document_id = $1 AND user_id = $2
  `, [documentId, userId]);
}

async function canAccess(documentId: string, userId: string): Promise<boolean> {
  // Check explicit access
  const explicit = await pool.query(`
    SELECT access_level FROM document_access WHERE document_id = $1 AND user_id = $2
  `, [documentId, userId]);
  
  if (explicit.rows[0]) return true;
  
  // Check document access level
  const doc = await getDocumentById(documentId);
  if (!doc) return false;
  
  if (doc.access_level === 'private') return doc.owner_id === userId;
  if (doc.access_level === 'team') {
    const user = await pool.query('SELECT team_id FROM officers WHERE id = $1', [userId]);
    return user.rows[0]?.team_id === doc.department_id;
  }
  
  return doc.access_level === 'company';
}

// ===========================================
// Templates
// ===========================================

interface Template {
  id: string;
  name: string;
  category: DocumentCategory;
  content: string;
  variables: string[];
}

async function createTemplate(data: Partial<Template>): Promise<Template> {
  const id = uuidv4();
  const [template] = await pool.query(`
    INSERT INTO document_templates (id, name, category, content, variables)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING *
  `, [id, data.name, data.category, data.content, data.variables]);
  return template;
}

async function generateFromTemplate(templateId: string, variables: Record<string, string>): Promise<string> {
  const template = await pool.query('SELECT * FROM document_templates WHERE id = $1', [templateId]);
  
  if (!template.rows[0]) throw new Error('Template not found');
  
  let content = template.rows[0].content;
  for (const [key, value] of Object.entries(variables)) {
    content = content.replace(new RegExp(`{{${key}}}`, 'g'), value);
  }
  
  return content;
}

// ===========================================
// API Routes
// ===========================================

// Upload
app.post('/api/documents', async (req: Request, res: Response) => {
  try {
    // In production, use multer for file upload
    const document = await uploadDocument({
      ...req.body,
      file_buffer: Buffer.from(req.body.file_data || ''),
    });
    res.status(201).json({ success: true, data: document });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to upload document' });
  }
});

// List
app.get('/api/documents', async (req: Request, res: Response) => {
  try {
    const documents = await getDocuments(req.query as any);
    res.json({ success: true, data: documents });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch documents' });
  }
});

// Get
app.get('/api/documents/:id', async (req: Request, res: Response) => {
  try {
    const document = await getDocumentById(req.params.id);
    if (!document) return res.status(404).json({ success: false, error: 'Document not found' });
    res.json({ success: true, data: document });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch document' });
  }
});

// Download
app.get('/api/documents/:id/download', async (req: Request, res: Response) => {
  try {
    const buffer = await downloadDocument(req.params.id);
    if (!buffer) return res.status(404).json({ success: false, error: 'Document not found' });
    res.send(buffer);
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to download document' });
  }
});

// Delete
app.delete('/api/documents/:id', async (req: Request, res: Response) => {
  try {
    await deleteDocument(req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to delete document' });
  }
});

// Versions
app.get('/api/documents/:id/versions', async (req: Request, res: Response) => {
  try {
    const versions = await getVersionHistory(req.params.id);
    res.json({ success: true, data: versions });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch versions' });
  }
});

// Signatures
app.post('/api/documents/:id/sign', async (req: Request, res: Response) => {
  try {
    const { signers } = req.body;
    await requestSignature(req.params.id, signers);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to request signature' });
  }
});

app.post('/api/documents/:id/sign/confirm', async (req: Request, res: Response) => {
  try {
    const { signer_id, signature_data } = req.body;
    const ip = req.ip;
    const signature = await signDocument(req.params.id, signer_id, signature_data, ip);
    res.json({ success: true, data: signature });
  } catch (error) {
    res.status(400).json({ success: false, error: (error as Error).message });
  }
});

app.get('/api/documents/:id/signatures', async (req: Request, res: Response) => {
  try {
    const status = await getSignatureStatus(req.params.id);
    res.json({ success: true, data: status });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch signatures' });
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

app.get('/api/templates/:id/generate', async (req: Request, res: Response) => {
  try {
    const { variables } = req.body;
    const content = await generateFromTemplate(req.params.id, variables);
    res.json({ success: true, data: { content } });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to generate document' });
  }
});

// Health
app.get('/health', async (req: Request, res: Response) => {
  res.json({ status: 'healthy', service: 'document-management' });
});

const PORT = process.env.PORT || 3019;

app.listen(PORT, () => console.log(`Document Management Service on port ${PORT}`));

export default app;