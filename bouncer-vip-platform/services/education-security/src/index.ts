// ===========================================
// Education Security Service
// School, university, campus security
// ===========================================

import express, { Request, Response } from 'express';
import { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';

const app = express();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
app.use(express.json());

// Campus Management
async function registerCampus(data: { name: string; type: string; students: number; buildings: number }): Promise<any> {
  const id = uuidv4();
  await pool.query('INSERT INTO campuses (id, name, type, students, status) VALUES ($1, $2, $3, $4, $5)', [id, data.name, data.type, data.students, 'active']);
  return { id, ...data };
}

async function getCampuses(): Promise<any[]> {
  const result = await pool.query('SELECT * FROM campuses');
  return result.rows;
}

// Student Safety
async function checkInStudent(data: { campus_id: string; student_id: string; location: string }): Promise<void> {
  await pool.query('INSERT INTO student_checkins (id, campus_id, student_id, location, checked_at) VALUES ($1, $2, $3, $4, NOW())', [uuidv4(), data.campus_id, data.student_id, data.location]);
}

async function getStudentLocations(campusId: string): Promise<any[]> {
  const result = await pool.query('SELECT * FROM student_checkins WHERE campus_id = $1 ORDER BY checked_at DESC', [campusId]);
  return result.rows;
}

// Emergency Response
async function triggerLockdown(campusId: string, level: string): Promise<void> {
  await pool.query('INSERT INTO lockdowns (id, campus_id, level, triggered_at) VALUES ($1, $2, $3, NOW())', [uuidv4(), campusId, level]);
}

async function getLockdownStatus(campusId: string): Promise<any> {
  const result = await pool.query('SELECT * FROM lockdowns WHERE campus_id = $1 ORDER BY triggered_at DESC LIMIT 1', [campusId]);
  return result.rows[0];
}

// Visitor Management
async function registerVisitor(data: { campus_id: string; name: string; purpose: string; host: string }): Promise<any> {
  const id = uuidv4();
  await pool.query('INSERT INTO campus_visitors (id, campus_id, name, purpose, host, check_in) VALUES ($1, $2, $3, $4, $5, NOW())', [id, data.campus_id, data.name, data.purpose, data.host]);
  return { id, ...data };
}

async function checkOutVisitor(visitorId: string): Promise<void> {
  await pool.query('UPDATE campus_visitors SET check_out = NOW() WHERE id = $1', [visitorId]);
}

// API Routes
app.post('/api/campuses', async (req, res) => { const c = await registerCampus(req.body); res.json({ success: true, data: c }); });
app.get('/api/campuses', async (req, res) => { const c = await getCampuses(); res.json({ success: true, data: c }); });
app.post('/api/students/checkin', async (req, res) => { await checkInStudent(req.body); res.json({ success: true }); });
app.get('/api/students/:campusId', async (req, res) => { const l = await getStudentLocations(req.params.campusId); res.json({ success: true, data: l }); });
app.post('/api/lockdown', async (req, res) => { await triggerLockdown(req.body.campus_id, req.body.level); res.json({ success: true }); });
app.get('/api/lockdown/:campusId', async (req, res) => { const s = await getLockdownStatus(req.params.campusId); res.json({ success: true, data: s }); });
app.post('/api/visitors', async (req, res) => { const v = await registerVisitor(req.body); res.json({ success: true, data: v }); });
app.post('/api/visitors/:id/checkout', async (req, res) => { await checkOutVisitor(req.params.id); res.json({ success: true }); });
app.get('/health', (req, res) => res.json({ status: 'healthy', service: 'education-security' }));

const PORT = process.env.PORT || 3145;
app.listen(PORT, () => console.log(`Education Security Service on port ${PORT}`));

export default app;