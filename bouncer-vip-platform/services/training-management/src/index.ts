// ===========================================
// Training Management Service
// Officer certifications, courses & compliance
// ===========================================

import express, { Request, Response } from 'express';
import { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';

const app = express();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

app.use(express.json());

// ===========================================
// Course Management
// ===========================================

interface Course {
  id: string;
  name: string;
  description: string;
  category: string;
  duration_hours: number;
  is_mandatory: boolean;
  valid_for_days: number;
  passing_score: number;
  created_at: string;
}

interface TrainingSession {
  id: string;
  course_id: string;
  instructor_id: string;
  venue_id?: string;
  start_date: string;
  end_date: string;
  max_attendees: number;
  status: 'scheduled' | 'in_progress' | 'completed' | 'cancelled';
}

interface Enrollment {
  id: string;
  officer_id: string;
  session_id: string;
  status: 'enrolled' | 'attended' | 'completed' | 'failed' | 'absent';
  score?: number;
  certificate_url?: string;
  completed_at?: string;
}

// ===========================================
// Course CRUD
// ===========================================

async function createCourse(data: Partial<Course>): Promise<Course> {
  const id = uuidv4();
  const [course] = await pool.query(`
    INSERT INTO training_courses (id, name, description, category, duration_hours, is_mandatory, valid_for_days, passing_score)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING *
  `, [id, data.name, data.description, data.category, data.duration_hours, data.is_mandatory, data.valid_for_days, data.passing_score]);
  return course;
}

async function getCourses(filters?: { category?: string; mandatory?: boolean }): Promise<Course[]> {
  let query = 'SELECT * FROM training_courses WHERE deleted_at IS NULL';
  const params: any[] = [];
  
  if (filters?.category) {
    params.push(filters.category);
    query += ` AND category = $${params.length}`;
  }
  if (filters?.mandatory !== undefined) {
    params.push(filters.mandatory);
    query += ` AND is_mandatory = $${params.length}`;
  }
  
  query += ' ORDER BY name';
  const result = await pool.query(query, params);
  return result.rows;
}

async function getCourseById(id: string): Promise<Course | null> {
  const result = await pool.query('SELECT * FROM training_courses WHERE id = $1', [id]);
  return result.rows[0] || null;
}

// ===========================================
// Session Management
// ===========================================

async function createSession(data: Partial<TrainingSession>): Promise<TrainingSession> {
  const id = uuidv4();
  const [session] = await pool.query(`
    INSERT INTO training_sessions (id, course_id, instructor_id, venue_id, start_date, end_date, max_attendees, status)
    VALUES ($1, $2, $3, $4, $5, $6, $7, 'scheduled')
    RETURNING *
  `, [id, data.course_id, data.instructor_id, data.venue_id, data.start_date, data.end_date, data.max_attendees]);
  return session;
}

async function getSessions(filters?: { course_id?: string; status?: string }): Promise<TrainingSession[]> {
  let query = 'SELECT * FROM training_sessions WHERE deleted_at IS NULL';
  const params: any[] = [];
  
  if (filters?.course_id) {
    params.push(filters.course_id);
    query += ` AND course_id = $${params.length}`;
  }
  if (filters?.status) {
    params.push(filters.status);
    query += ` AND status = $${params.length}`;
  }
  
  query += ' ORDER BY start_date';
  const result = await pool.query(query, params);
  return result.rows;
}

async function enrollOfficer(officerId: string, sessionId: string): Promise<Enrollment> {
  // Check capacity
  const enrollmentCount = await pool.query(
    'SELECT COUNT(*) as count FROM training_enrollments WHERE session_id = $1',
    [sessionId]
  );
  const session = await pool.query('SELECT max_attendees FROM training_sessions WHERE id = $1', [sessionId]);
  
  if (parseInt(enrollmentCount.rows[0]?.count) >= session.rows[0]?.max_attendees) {
    throw new Error('Session is full');
  }
  
  const id = uuidv4();
  const [enrollment] = await pool.query(`
    INSERT INTO training_enrollments (id, officer_id, session_id, status)
    VALUES ($1, $2, $3, 'enrolled')
    RETURNING *
  `, [id, officerId, sessionId]);
  
  return enrollment;
}

async function recordAttendance(sessionId: string, officerIds: string[]): Promise<void> {
  for (const officerId of officerIds) {
    await pool.query(`
      UPDATE training_enrollments SET status = 'attended'
      WHERE session_id = $1 AND officer_id = $2
    `, [sessionId, officerId]);
  }
}

async function recordResults(sessionId: string, results: { officer_id: string; score: number; passed: boolean }[]): Promise<void> {
  for (const result of results) {
    const status = result.passed ? 'completed' : 'failed';
    const [enrollment] = await pool.query(`
      UPDATE training_enrollments 
      SET status = $1, score = $2, completed_at = NOW()
      WHERE session_id = $3 AND officer_id = $4
      RETURNING *
    `, [status, result.score, sessionId, result.officer_id]);
    
    // Generate certificate if passed
    if (result.passed) {
      const certUrl = `/certificates/${enrollment.id}.pdf`;
      await pool.query(`
        UPDATE training_enrollments SET certificate_url = $1 WHERE id = $2
      `, [certUrl, enrollment.id]);
    }
  }
}

// ===========================================
// Officer Training Records
// ===========================================

interface OfficerTrainingRecord {
  officer_id: string;
  course_name: string;
  completed_at: string;
  score: number;
  certificate_url?: string;
  expires_at?: string;
  status: 'valid' | 'expiring' | 'expired';
}

async function getOfficerTrainingHistory(officerId: string): Promise<OfficerTrainingRecord[]> {
  const result = await pool.query(`
    SELECT e.officer_id, c.name as course_name, e.completed_at, e.score, e.certificate_url,
           CASE 
             WHEN e.completed_at + INTERVAL '1 day' * c.valid_for_days < NOW() THEN 'expired'
             WHEN e.completed_at + INTERVAL '1 day' * c.valid_for_days < NOW() + INTERVAL '30 days' THEN 'expiring'
             ELSE 'valid'
           END as status
    FROM training_enrollments e
    JOIN training_sessions s ON e.session_id = s.id
    JOIN training_courses c ON s.course_id = c.id
    WHERE e.officer_id = $1 AND e.status = 'completed'
    ORDER BY e.completed_at DESC
  `, [officerId]);
  return result.rows;
}

async function getOfficerComplianceStatus(officerId: string): Promise<{
  mandatory_courses: Course[];
  completed_courses: string[];
  compliance_rate: number;
}> {
  // Get mandatory courses
  const mandatoryCourses = await pool.query(
    'SELECT * FROM training_courses WHERE is_mandatory = true AND deleted_at IS NULL'
  );
  
  // Get completed mandatory courses
  const completed = await pool.query(`
    SELECT c.id
    FROM training_enrollments e
    JOIN training_sessions s ON e.session_id = s.id
    JOIN training_courses c ON s.course_id = c.id
    WHERE e.officer_id = $1 AND e.status = 'completed' AND c.is_mandatory = true
  `, [officerId]);
  
  const completedIds = completed.rows.map(r => r.id);
  const complianceRate = (completedIds.length / mandatoryCourses.rows.length) * 100;
  
  return {
    mandatory_courses: mandatoryCourses.rows,
    completed_courses: completedIds,
    compliance_rate: Math.round(complianceRate),
  };
}

async function getExpiringCertifications(daysAhead: number = 30): Promise<any[]> {
  const result = await pool.query(`
    SELECT e.officer_id, o.first_name, o.last_name, o.email, c.name as course_name,
           e.completed_at, c.valid_for_days,
           e.completed_at + INTERVAL '1 day' * c.valid_for_days as expires_at
    FROM training_enrollments e
    JOIN training_sessions s ON e.session_id = s.id
    JOIN training_courses c ON s.course_id = c.id
    JOIN officers o ON e.officer_id = o.id
    WHERE e.status = 'completed'
      AND e.completed_at + INTERVAL '1 day' * c.valid_for_days BETWEEN NOW() AND NOW() + INTERVAL '1 day' * $1
    ORDER BY expires_at
  `, [daysAhead]);
  return result.rows;
}

// ===========================================
// Compliance Reporting
// ===========================================

async function getComplianceReport(): Promise<{
  overall_compliance: number;
  by_course: { course_name: string; completion_rate: number }[];
  non_compliant_officers: { id: string; name: string; missing_courses: string[] }[];
}> {
  const courses = await pool.query('SELECT id, name FROM training_courses WHERE is_mandatory = true');
  const byCourse = [];
  
  for (const course of courses.rows) {
    const totalOfficers = await pool.query('SELECT COUNT(*) as count FROM officers WHERE status = $1', ['active']);
    const completedOfficers = await pool.query(`
      SELECT COUNT(DISTINCT e.officer_id) as count
      FROM training_enrollments e
      JOIN training_sessions s ON e.session_id = s.id
      WHERE s.course_id = $1 AND e.status = 'completed'
    `, [course.id]);
    
    const rate = (completedOfficers.rows[0]?.count / totalOfficers.rows[0]?.count) * 100;
    byCourse.push({ course_name: course.name, completion_rate: Math.round(rate) });
  }
  
  const avgCompliance = byCourse.reduce((sum, c) => sum + c.completion_rate, 0) / byCourse.length;
  
  return {
    overall_compliance: Math.round(avgCompliance),
    by_course: byCourse,
    non_compliant_officers: [],
  };
}

// ===========================================
// API Routes
// ===========================================

// Courses
app.post('/api/courses', async (req: Request, res: Response) => {
  try {
    const course = await createCourse(req.body);
    res.status(201).json({ success: true, data: course });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to create course' });
  }
});

app.get('/api/courses', async (req: Request, res: Response) => {
  try {
    const { category, mandatory } = req.query as any;
    const courses = await getCourses({ category, mandatory: mandatory === 'true' });
    res.json({ success: true, data: courses });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch courses' });
  }
});

app.get('/api/courses/:id', async (req: Request, res: Response) => {
  try {
    const course = await getCourseById(req.params.id);
    if (!course) return res.status(404).json({ success: false, error: 'Course not found' });
    res.json({ success: true, data: course });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch course' });
  }
});

// Sessions
app.post('/api/sessions', async (req: Request, res: Response) => {
  try {
    const session = await createSession(req.body);
    res.status(201).json({ success: true, data: session });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to create session' });
  }
});

app.get('/api/sessions', async (req: Request, res: Response) => {
  try {
    const { course_id, status } = req.query as any;
    const sessions = await getSessions({ course_id, status });
    res.json({ success: true, data: sessions });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch sessions' });
  }
});

// Enrollments
app.post('/api/sessions/:id/enroll', async (req: Request, res: Response) => {
  try {
    const { officer_id } = req.body;
    const enrollment = await enrollOfficer(officer_id, req.params.id);
    res.status(201).json({ success: true, data: enrollment });
  } catch (error) {
    res.status(400).json({ success: false, error: (error as Error).message });
  }
});

app.post('/api/sessions/:id/attendance', async (req: Request, res: Response) => {
  try {
    const { officer_ids } = req.body;
    await recordAttendance(req.params.id, officer_ids);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to record attendance' });
  }
});

app.post('/api/sessions/:id/results', async (req: Request, res: Response) => {
  try {
    const { results } = req.body;
    await recordResults(req.params.id, results);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to record results' });
  }
});

// Officer Training
app.get('/api/officers/:id/training', async (req: Request, res: Response) => {
  try {
    const history = await getOfficerTrainingHistory(req.params.id);
    res.json({ success: true, data: history });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch training history' });
  }
});

app.get('/api/officers/:id/compliance', async (req: Request, res: Response) => {
  try {
    const compliance = await getOfficerComplianceStatus(req.params.id);
    res.json({ success: true, data: compliance });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch compliance status' });
  }
});

// Expiring
app.get('/api/compliance/expiring', async (req: Request, res: Response) => {
  try {
    const { days } = req.query;
    const expirations = await getExpiringCertifications(parseInt(days as any) || 30);
    res.json({ success: true, data: expirations });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch expirations' });
  }
});

// Report
app.get('/api/compliance/report', async (req: Request, res: Response) => {
  try {
    const report = await getComplianceReport();
    res.json({ success: true, data: report });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to generate report' });
  }
});

// Health
app.get('/health', async (req: Request, res: Response) => {
  res.json({ status: 'healthy', service: 'training-management' });
});

const PORT = process.env.PORT || 3018;

app.listen(PORT, () => console.log(`Training Management Service on port ${PORT}`));

export default app;