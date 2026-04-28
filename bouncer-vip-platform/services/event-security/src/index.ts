// ===========================================
// Event Security Service
// Concerts, conferences, sports events
// ===========================================

import express, { Request, Response } from 'express';
import { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';

const app = express();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
app.use(express.json());

// Types
interface Event { id: string; name: string; type: string; date: string; venue: string; capacity: number; risk_level: string; }
interface Ticket { id: string; event_id: string; type: string; price: number; quantity: number; sold: number; }
interface Attendee { id: string; event_id: string; name: string; ticket_type: string; vip: boolean; }

// Event Management
async function createEvent(data: { name: string; type: string; date: string; venue: string; capacity: number }): Promise<Event> {
  const id = uuidv4();
  await pool.query(`INSERT INTO events (id, name, type, date, venue, capacity, risk_level, status) VALUES ($1, $2, $3, $4, $5, $6, 'active')`, [id, data.name, data.type, data.date, data.venue, data.capacity]);
  return { id, ...data, risk_level: 'medium' };
}

async function getEvents(): Promise<Event[]> {
  const result = await pool.query('SELECT * FROM events ORDER BY date DESC');
  return result.rows;
}

async function getEvent(id: string): Promise<Event | null> {
  const result = await pool.query('SELECT * FROM events WHERE id = $1', [id]);
  return result.rows[0];
}

// Ticket Types
async function createTicketType(data: { event_id: string; type: string; price: number; quantity: number }): Promise<Ticket> {
  const id = uuidv4();
  await pool.query(`INSERT INTO event_tickets (id, event_id, type, price, quantity, sold) VALUES ($1, $2, $3, $4, $5, 0)`, [id, data.event_id, data.type, data.price, data.quantity]);
  return { id, ...data, sold: 0 };
}

async function getTicketTypes(eventId: string): Promise<Ticket[]> {
  const result = await pool.query('SELECT * FROM event_tickets WHERE event_id = $1', [eventId]);
  return result.rows;
}

// Attendance Tracking
async function checkInAttendee(data: { event_id: string; name: string; ticket_type: string }): Promise<Attendee> {
  const id = uuidv4();
  await pool.query(`INSERT INTO event_attendees (id, event_id, name, ticket_type, checked_in) VALUES ($1, $2, $3, $4, NOW())`, [id, data.event_id, data.name, data.ticket_type]);
  return { id, ...data, vip: false };
}

async function getAttendance(eventId: string): Promise<{ total: number; checked_in: number; vip: number }> {
  const [total, checked, vip] = await Promise.all([
    pool.query('SELECT COUNT(*) FROM event_attendees WHERE event_id = $1', [eventId]),
    pool.query('SELECT COUNT(*) FROM event_attendees WHERE event_id = $1 AND checked_in IS NOT NULL', [eventId]),
    pool.query('SELECT COUNT(*) FROM event_attendees WHERE event_id = $1 AND vip = true', [eventId]),
  ]);
  return { total: parseInt(total.rows[0]?.count || '0'), checked_in: parseInt(checked.rows[0]?.count || '0'), vip: parseInt(vip.rows[0]?.count || '0') };
}

// Security Perimeter
async function createPerimeter(eventId: string, zones: { name: string; capacity: number }[]): Promise<void> {
  await pool.query('INSERT INTO event_zones (id, event_id, name, capacity) VALUES ($1, $2, $3, $4)', [uuidv4(), eventId, JSON.stringify(zones), 0]);
}

async function getZoneCapacity(eventId: string): Promise<any[]> {
  const result = await pool.query('SELECT zone, COUNT(*) as current FROM attendee_locations WHERE event_id = $1 GROUP BY zone', [eventId]);
  return result.rows;
}

// Crowd Management
async function getCrowdDensity(eventId: string): Promise<any> {
  const result = await pool.query('SELECT AVG(density) as avg_density FROM crowd_sensors WHERE event_id = $1', [eventId]);
  return { density: parseFloat(result.rows[0]?.avg_density || '0') };
}

// API Routes
app.post('/api/events', async (req, res) => { const event = await createEvent(req.body); res.json({ success: true, data: event }); });
app.get('/api/events', async (req, res) => { const events = await getEvents(); res.json({ success: true, data: events }); });
app.get('/api/events/:id', async (req, res) => { const event = await getEvent(req.params.id); res.json({ success: true, data: event }); });
app.post('/api/tickets', async (req, res) => { const ticket = await createTicketType(req.body); res.json({ success: true, data: ticket }); });
app.get('/api/tickets/:eventId', async (req, res) => { const tickets = await getTicketTypes(req.params.eventId); res.json({ success: true, data: tickets }); });
app.post('/api/attendees/checkin', async (req, res) => { const attendee = await checkInAttendee(req.body); res.json({ success: true, data: attendee }); });
app.get('/api/attendance/:eventId', async (req, res) => { const attendance = await getAttendance(req.params.eventId); res.json({ success: true, data: attendance }); });
app.get('/api/crowd/:eventId', async (req, res) => { const crowd = await getCrowdDensity(req.params.eventId); res.json({ success: true, data: crowd }); });
app.get('/health', (req, res) => res.json({ status: 'healthy', service: 'event-security' }));

const PORT = process.env.PORT || 3142;
app.listen(PORT, () => console.log(`Event Security Service on port ${PORT}`));

export default app;