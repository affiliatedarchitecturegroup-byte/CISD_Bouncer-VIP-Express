// ===========================================
// Hospitality Security Service
// Hotel, resort, restaurant security
// ===========================================

import express, { Request, Response } from 'express';
import { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';

const app = express();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
app.use(express.json());

// Types
interface Hotel { id: string; name: string; stars: number; rooms: number; facilities: string[]; }
interface Guest { id: string; hotel_id: string; name: string; room: string; check_in: string; check_out: string; vip: boolean; }
interface Incident { id: string; hotel_id: string; type: string; location: string; severity: string; resolved: boolean; }

// Hotel Management
async function registerHotel(data: { name: string; stars: number; rooms: number }): Promise<Hotel> {
  const id = uuidv4();
  await pool.query(`INSERT INTO hotels (id, name, stars, rooms, facilities, status) VALUES ($1, $2, $3, $4, $5, 'active')`, [id, data.name, data.stars, data.rooms, JSON.stringify([])]);
  return { id, ...data, facilities: [] };
}

async function getHotels(): Promise<Hotel[]> {
  const result = await pool.query('SELECT * FROM hotels');
  return result.rows;
}

// Guest Management
async function checkInGuest(data: { hotel_id: string; name: string; room: string; check_in: string; check_out: string }): Promise<Guest> {
  const id = uuidv4();
  await pool.query(`INSERT INTO hotel_guests (id, hotel_id, name, room, check_in, check_out) VALUES ($1, $2, $3, $4, $5, $6)`, [id, data.hotel_id, data.name, data.room, data.check_in, data.check_out]);
  return { id, ...data, vip: false };
}

async function getGuests(hotelId: string): Promise<Guest[]> {
  const result = await pool.query('SELECT * FROM hotel_guests WHERE hotel_id = $1 AND check_in <= NOW() AND check_out >= NOW()', [hotelId]);
  return result.rows;
}

// VIP Guest Protection
async function markVIP(guestId: string): Promise<void> {
  await pool.query('UPDATE hotel_guests SET vip = true WHERE id = $1', [guestId]);
}

async function getVIPGuests(hotelId: string): Promise<Guest[]> {
  const result = await pool.query('SELECT * FROM hotel_guests WHERE hotel_id = $1 AND vip = true', [hotelId]);
  return result.rows;
}

// Room Security Monitoring
async function getRoomAccess(hotelId: string): Promise<any[]> {
  const result = await pool.query('SELECT room, access_count, last_access FROM room_access WHERE hotel_id = $1 ORDER BY last_access DESC', [hotelId]);
  return result.rows;
}

// Incident Reporting
async function reportIncident(data: { hotel_id: string; type: string; location: string; severity: string }): Promise<Incident> {
  const id = uuidv4();
  await pool.query(`INSERT INTO hotel_incidents (id, hotel_id, type, location, severity, resolved) VALUES ($1, $2, $3, $4, $5, false)`, [id, data.hotel_id, data.type, data.location, data.severity]);
  return { id, ...data, resolved: false };
}

async function getIncidents(hotelId: string): Promise<Incident[]> {
  const result = await pool.query('SELECT * FROM hotel_incidents WHERE hotel_id = $1 ORDER BY created_at DESC', [hotelId]);
  return result.rows;
}

// API Routes
app.post('/api/hotels', async (req, res) => { const hotel = await registerHotel(req.body); res.json({ success: true, data: hotel }); });
app.get('/api/hotels', async (req, res) => { const hotels = await getHotels(); res.json({ success: true, data: hotels }); });
app.post('/api/guests/checkin', async (req, res) => { const guest = await checkInGuest(req.body); res.json({ success: true, data: guest }); });
app.get('/api/guests/:hotelId', async (req, res) => { const guests = await getGuests(req.params.hotelId); res.json({ success: true, data: guests }); });
app.post('/api/guests/:id/vip', async (req, res) => { await markVIP(req.params.id); res.json({ success: true }); });
app.get('/api/vip/:hotelId', async (req, res) => { const vips = await getVIPGuests(req.params.hotelId); res.json({ success: true, data: vips }); });
app.get('/api/access/:hotelId', async (req, res) => { const access = await getRoomAccess(req.params.hotelId); res.json({ success: true, data: access }); });
app.post('/api/incidents', async (req, res) => { const incident = await reportIncident(req.body); res.json({ success: true, data: incident }); });
app.get('/api/incidents/:hotelId', async (req, res) => { const incidents = await getIncidents(req.params.hotelId); res.json({ success: true, data: incidents }); });
app.get('/health', (req, res) => res.json({ status: 'healthy', service: 'hospitality-security' }));

const PORT = process.env.PORT || 3140;
app.listen(PORT, () => console.log(`Hospitality Security Service on port ${PORT}`));

export default app;