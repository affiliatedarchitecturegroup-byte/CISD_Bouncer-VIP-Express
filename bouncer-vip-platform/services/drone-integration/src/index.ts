// ===========================================
// Drone Integration Service
// UAV surveillance, patrol drones, monitoring
// ===========================================

import express, { Request, Response } from 'express';
import { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';

const app = express();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
app.use(express.json());

// Types
interface Drone { id: string; name: string; type: string; status: string; battery: number; location: { lat: number; lng: number }; }
interface FlightLog { id: string; drone_id: string; start_time: string; end_time?: string; path: { lat: number; lng: number }[]; }

// Drone Fleet Management
async function registerDrone(data: { name: string; type: string }): Promise<Drone> {
  const id = uuidv4();
  await pool.query(`INSERT INTO drones (id, name, type, status, battery) VALUES ($1, $2, $3, 'idle', 100)`, [id, data.name, data.type]);
  return { id, ...data, status: 'idle', battery: 100, location: { lat: 0, lng: 0 } };
}

async function getDrones(): Promise<Drone[]> {
  const result = await pool.query('SELECT * FROM drones');
  return result.rows;
}

async function updateDroneLocation(droneId: string, lat: number, lng: number): Promise<void> {
  await pool.query('UPDATE drones SET location = $1 WHERE id = $2', [JSON.stringify({ lat, lng }), droneId]);
}

async function updateDroneBattery(droneId: string, battery: number): Promise<void> {
  await pool.query('UPDATE drones SET battery = $1 WHERE id = $2', [battery, droneId]);
}

// Flight Operations
async function startFlight(droneId: string, mission: string): Promise<FlightLog> {
  const id = uuidv4();
  await pool.query('INSERT INTO flight_logs (id, drone_id, start_time, mission) VALUES ($1, $2, NOW(), $3)', [id, droneId, mission]);
  await pool.query('UPDATE drones SET status = $1 WHERE id = $2', ['flying', droneId]);
  return { id, drone_id: droneId, start_time: new Date().toISOString(), path: [] };
}

async function endFlight(logId: string): Promise<void> {
  await pool.query('UPDATE flight_logs SET end_time = NOW() WHERE id = $1', [logId]);
  const log = await pool.query('SELECT drone_id FROM flight_logs WHERE id = $1', [logId]);
  await pool.query('UPDATE drones SET status = $1 WHERE id = $2', ['idle', log.rows[0].drone_id]);
}

async function recordPathPoint(logId: string, lat: number, lng: number): Promise<void> {
  await pool.query('UPDATE flight_logs SET path = path || $1 WHERE id = $2', [JSON.stringify([{ lat, lng }]), logId]);
}

// Patrol Missions
async function createPatrolMission(data: { drone_id: string; waypoints: { lat: number; lng: number }[]; altitude: number }): Promise<any> {
  const id = uuidv4();
  await pool.query('INSERT INTO patrol_missions (id, drone_id, waypoints, altitude, status) VALUES ($1, $2, $3, $4, $1)', [id, data.drone_id, JSON.stringify(data.waypoints), data.altitude]);
  return { id, ...data, status: 'scheduled' };
}

async function getMissionTelemetry(missionId: string): Promise<any> {
  const result = await pool.query('SELECT * FROM patrol_missions WHERE id = $1', [missionId]);
  return result.rows[0];
}

// API Routes
app.post('/api/drones', async (req, res) => { const drone = await registerDrone(req.body); res.json({ success: true, data: drone }); });
app.get('/api/drones', async (req, res) => { const drones = await getDrones(); res.json({ success: true, data: drones }); });
app.post('/api/drones/:id/location', async (req, res) => { await updateDroneLocation(req.params.id, req.body.lat, req.body.lng); res.json({ success: true }); });
app.post('/api/flights/start', async (req, res) => { const log = await startFlight(req.body.drone_id, req.body.mission); res.json({ success: true, data: log }); });
app.post('/api/flights/:id/end', async (req, res) => { await endFlight(req.params.id); res.json({ success: true }); });
app.post('/api/patrols', async (req, res) => { const mission = await createPatrolMission(req.body); res.json({ success: true, data: mission }); });
app.get('/health', (req, res) => res.json({ status: 'healthy', service: 'drone-integration' }));

const PORT = process.env.PORT || 3120;
app.listen(PORT, () => console.log(`Drone Integration Service on port ${PORT}`));

export default app;