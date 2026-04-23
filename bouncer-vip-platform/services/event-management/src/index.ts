// ===========================================
// Event Management Service
// Large event handling, logistics, and coordination
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
// Event Types
// ===========================================

type EventStatus = 'planning' | 'confirmed' | 'in_progress' | 'completed' | 'cancelled';
type EventType = 'concert' | 'festival' | 'sports' | 'conference' | 'corporate' | 'private' | 'community';
type EventSize = 'small' | 'medium' | 'large' | 'mega';

interface Event {
  id: string;
  name: string;
  type: EventType;
  size: EventSize;
  status: EventStatus;
  venue_id: string;
  start_date: string;
  end_date: string;
  expected_attendance: number;
  risk_level: 'low' | 'medium' | 'high' | 'critical';
  required_officers: number;
  assigned_officers: number;
  coordinator_id: string;
  created_at: string;
}

// ===========================================
// Event Planning
// ===========================================

interface EventRequirements {
  security: { officers: number; grade: string; equipment: string[] };
  medical: { staff: boolean; ambulance: boolean };
  parking: { attendants: number };
  access: { checkpoints: number; scanners: boolean };
}

function calculateRequirements(attendance: number, size: EventSize): EventRequirements {
  const ratios = {
    small: { officers: 0.02, medical: false, parking: 0.005, checkpoints: 1 },
    medium: { officers: 0.03, medical: true, parking: 0.008, checkpoints: 2 },
    large: { officers: 0.04, medical: true, ambulance: true, parking: 0.01, checkpoints: 3 },
    mega: { officers: 0.05, medical: true, ambulance: true, parking: 0.015, checkpoints: 4 },
  };
  
  const ratio = ratios[size];
  
  return {
    security: {
      officers: Math.ceil(attendance * ratio.officers),
      grade: size === 'mega' ? 'A' : size === 'large' ? 'B' : 'C',
      equipment: ['radio', 'flashlight', ...(size === 'mega' ? ['body_camera', 'vest'] : [])],
    },
    medical: {
      staff: ratio.medical || false,
      ambulance: (ratio as any).ambulance || false,
    },
    parking: {
      attendants: Math.ceil(attendance * (ratio as any).parking || 0.005),
    },
    access: {
      checkpoints: ratio.checkpoints,
      scanners: size === 'large' || size === 'mega',
    },
  };
}

async function createEvent(data: {
  name: string;
  type: EventType;
  venue_id: string;
  start_date: string;
  end_date: string;
  expected_attendance: number;
  coordinator_id: string;
}): Promise<Event> {
  const id = uuidv4();
  
  // Determine size based on attendance
  let size: EventSize = 'small';
  if (data.expected_attendance > 5000) size = 'medium';
  if (data.expected_attendance > 15000) size = 'large';
  if (data.expected_attendance > 50000) size = 'mega';
  
  const requirements = calculateRequirements(data.expected_attendance, size);
  
  // Risk assessment
  let riskLevel: 'low' | 'medium' | 'high' | 'critical' = 'medium';
  if (size === 'mega') riskLevel = 'critical';
  else if (size === 'large') riskLevel = 'high';
  else if (data.expected_attendance < 1000) riskLevel = 'low';
  
  const [event] = await pool.query(`
    INSERT INTO events (id, name, type, size, status, venue_id, start_date, end_date, 
                     expected_attendance, risk_level, required_officers, coordinator_id, requirements)
    VALUES ($1, $2, $3, $4, 'planning', $5, $6, $7, $8, $9, $10, $11, $12)
    RETURNING *
  `, [id, data.name, data.type, size, data.venue_id, data.start_date, data.end_date, 
      data.expected_attendance, riskLevel, requirements.security.officers, data.coordinator_id,
      JSON.stringify(requirements)]);
  
  return event;
}

async function getEvents(filters?: {
  status?: EventStatus;
  type?: EventType;
  from_date?: string;
  to_date?: string;
}): Promise<Event[]> {
  let query = 'SELECT * FROM events WHERE deleted_at IS NULL';
  const params: any[] = [];
  
  if (filters?.status) {
    params.push(filters.status);
    query += ` AND status = $${params.length}`;
  }
  if (filters?.type) {
    params.push(filters.type);
    query += ` AND type = $${params.length}`;
  }
  if (filters?.from_date) {
    params.push(filters.from_date);
    query += ` AND start_date >= $${params.length}`;
  }
  if (filters?.to_date) {
    params.push(filters.to_date);
    query += ` AND start_date <= $${params.length}`;
  }
  
  query += ' ORDER BY start_date';
  const result = await pool.query(query, params);
  return result.rows.map(r => ({ ...r, requirements: JSON.parse(r.requirements) }));
}

async function getEventById(id: string): Promise<Event | null> {
  const result = await pool.query('SELECT * FROM events WHERE id = $1', [id]);
  if (!result.rows[0]) return null;
  return { ...result.rows[0], requirements: JSON.parse(result.rows[0].requirements) };
}

// ===========================================
// Staff Assignment
// ===========================================

async function assignOfficer(eventId: string, officerId: string, role: string): Promise<void> {
  await pool.query(`
    INSERT INTO event_staff (id, event_id, officer_id, role)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT DO NOTHING
  `, [uuidv4(), eventId, officerId, role]);
  
  // Update count
  await pool.query(`
    UPDATE events SET assigned_officers = (
      SELECT COUNT(*) FROM event_staff WHERE event_id = $1
    ) WHERE id = $1
  `, [eventId]);
}

async function getEventStaff(eventId: string): Promise<any[]> {
  const result = await pool.query(`
    SELECT es.*, o.first_name, o.last_name, o.grade, o.phone
    FROM event_staff es
    JOIN officers o ON es.officer_id = o.id
    WHERE es.event_id = $1
  `, [eventId]);
  return result.rows;
}

// ===========================================
// Logistics
// ===========================================

interface LogisticsItem {
  id: string;
  event_id: string;
  category: string;
  item: string;
  quantity: number;
  status: 'pending' | 'delivered' | 'returned';
}

async function addLogistics(eventId: string, items: { category: string; item: string; quantity: number }[]): Promise<void> {
  for (const item of items) {
    await pool.query(`
      INSERT INTO event_logistics (id, event_id, category, item, quantity, status)
      VALUES ($1, $2, $3, $4, $5, 'pending')
    `, [uuidv4(), eventId, item.category, item.item, item.quantity]);
  }
}

async function getLogistics(eventId: string): Promise<LogisticsItem[]> {
  const result = await pool.query(`
    SELECT * FROM event_logistics WHERE event_id = $1 ORDER BY category
  `, [eventId]);
  return result.rows;
}

// ===========================================
// Checkpoints
// ===========================================

interface Checkpoint {
  id: string;
  event_id: string;
  name: string;
  location: string;
  capacity: number;
  staff_required: number;
  status: 'setup' | 'active' | 'closed';
}

async function setupCheckpoints(eventId: string, checkpoints: { name: string; location: string; capacity: number }[]): Promise<void> {
  for (const cp of checkpoints) {
    const staffRequired = Math.ceil(cp.capacity / 100);
    await pool.query(`
      INSERT INTO event_checkpoints (id, event_id, name, location, capacity, staff_required, status)
      VALUES ($1, $2, $3, $4, $5, $6, 'setup')
    `, [uuidv4(), eventId, cp.name, cp.location, cp.capacity, staffRequired]);
  }
}

async function getCheckpoints(eventId: string): Promise<Checkpoint[]> {
  const result = await pool.query(`
    SELECT * FROM event_checkpoints WHERE event_id = $1
  `, [eventId]);
  return result.rows;
}

// ===========================================
// Real-Time Monitoring
// ===========================================

interface EventMetrics {
  checked_in: number;
  current_attendance: number;
  incidents: number;
  bottlenecks: number;
}

async function getEventMetrics(eventId: string): Promise<EventMetrics> {
  const [checkedIn, currentAttendance, incidents, bottlenecks] = await Promise.all([
    pool.query(`SELECT COUNT(*) as count FROM event_checkins WHERE event_id = $1`, [eventId]),
    pool.query(`SELECT current_attendance FROM events WHERE id = $1`, [eventId]),
    pool.query(`SELECT COUNT(*) as count FROM incidents WHERE event_id = $1 AND status != 'closed'`, [eventId]),
    pool.query(`SELECT COUNT(*) as count FROM event_checkpoints WHERE event_id = $1 AND wait_time > 300`, [eventId]),
  ]);
  
  return {
    checked_in: parseInt(checkedIn.rows[0]?.count || '0'),
    current_attendance: parseInt(currentAttendance.rows[0]?.current_attendance || '0'),
    incidents: parseInt(incidents.rows[0]?.count || '0'),
    bottlenecks: parseInt(bottlenecks.rows[0]?.count || '0'),
  };
}

// ===========================================
// Post-Event Analysis
// ===========================================

interface EventReport {
  total_officers: number;
  total_hours: number;
  incidents_count: number;
  attendance_actual: number;
  attendance_expected: number;
  efficiency_score: number;
}

async function generateEventReport(eventId: string): Promise<EventReport> {
  const [staff, incidents, attendance] = await Promise.all([
    pool.query(`
      SELECT COUNT(*) as count, SUM(hours_worked) as hours 
      FROM event_staff WHERE event_id = $1
    `, [eventId]),
    pool.query(`SELECT COUNT(*) as count FROM incidents WHERE event_id = $1`, [eventId]),
    pool.query(`SELECT expected_attendance, actual_attendance FROM events WHERE id = $1`, [eventId]),
  ]);
  
  const expected = parseInt(attendance.rows[0]?.expected_attendance || '0');
  const actual = parseInt(attendance.rows[0]?.actual_attendance || '0');
  
  return {
    total_officers: parseInt(staff.rows[0]?.count || '0'),
    total_hours: parseFloat(staff.rows[0]?.hours || '0'),
    incidents_count: parseInt(incidents.rows[0]?.count || '0'),
    attendance_actual: actual,
    attendance_expected: expected,
    efficiency_score: expected > 0 ? Math.round((actual / expected) * 100) : 0,
  };
}

// ===========================================
// API Routes
// ===========================================

app.post('/api/events', async (req: Request, res: Response) => {
  try {
    const event = await createEvent(req.body);
    res.status(201).json({ success: true, data: event });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to create event' });
  }
});

app.get('/api/events', async (req: Request, res: Response) => {
  try {
    const events = await getEvents(req.query as any);
    res.json({ success: true, data: events });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch events' });
  }
});

app.get('/api/events/:id', async (req: Request, res: Response) => {
  try {
    const event = await getEventById(req.params.id);
    if (!event) return res.status(404).json({ error: 'Event not found' });
    res.json({ success: true, data: event });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch event' });
  }
});

app.post('/api/events/:id/staff', async (req: Request, res: Response) => {
  try {
    const { officer_id, role } = req.body;
    await assignOfficer(req.params.id, officer_id, role);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to assign staff' });
  }
});

app.get('/api/events/:id/staff', async (req: Request, res: Response) => {
  try {
    const staff = await getEventStaff(req.params.id);
    res.json({ success: true, data: staff });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch staff' });
  }
});

app.post('/api/events/:id/logistics', async (req: Request, res: Response) => {
  try {
    const { items } = req.body;
    await addLogistics(req.params.id, items);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to add logistics' });
  }
});

app.get('/api/events/:id/logistics', async (req: Request, res: Response) => {
  try {
    const logistics = await getLogistics(req.params.id);
    res.json({ success: true, data: logistics });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch logistics' });
  }
});

app.get('/api/events/:id/metrics', async (req: Request, res: Response) => {
  try {
    const metrics = await getEventMetrics(req.params.id);
    res.json({ success: true, data: metrics });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch metrics' });
  }
});

app.get('/api/events/:id/report', async (req: Request, res: Response) => {
  try {
    const report = await generateEventReport(req.params.id);
    res.json({ success: true, data: report });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to generate report' });
  }
});

app.get('/health', async (req: Request, res: Response) => {
  res.json({ status: 'healthy', service: 'event-management' });
});

const PORT = process.env.PORT || 3052;

app.listen(PORT, () => console.log(`Event Management Service on port ${PORT}`));

export default app;