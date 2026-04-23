// ===========================================
// Patrol Management Service
// GPS patrol routes, tracking, and reporting
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
// Patrol Types
// ===========================================

type PatrolStatus = 'pending' | 'in_progress' | 'completed' | 'aborted';
type PatrolType = 'foot' | 'vehicle' | 'bike';

interface Patrol {
  id: string;
  name: string;
  type: PatrolType;
  status: PatrolStatus;
  officer_id: string;
  route_id: string;
  start_time: string;
  end_time?: string;
  checkpoints_visited: number;
  total_distance: number;
}

// ===========================================
// Route Management
// ===========================================

interface PatrolRoute {
  id: string;
  name: string;
  checkpoints: Checkpoint[];
  estimated_duration: number; // minutes
  distance_km: number;
}

interface Checkpoint {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  order: number;
  instructions?: string;
}

async function createRoute(data: {
  name: string;
  checkpoints: { name: string; latitude: number; longitude: number; instructions?: string }[];
}): Promise<PatrolRoute> {
  const routeId = uuidv4();
  
  let totalDistance = 0;
  const processedCheckpoints: Checkpoint[] = [];
  
  for (let i = 0; i < data.checkpoints.length; i++) {
    const cp = data.checkpoints[i];
    const checkpoint: Checkpoint = {
      id: uuidv4(),
      name: cp.name,
      latitude: cp.latitude,
      longitude: cp.longitude,
      order: i + 1,
      instructions: cp.instructions,
    };
    
    if (i > 0) {
      const prev = processedCheckpoints[i - 1];
      totalDistance += calculateDistance(
        prev.latitude, prev.longitude,
        cp.latitude, cp.longitude
      );
    }
    
    processedCheckpoints.push(checkpoint);
  }
  
  const [route] = await pool.query(`
    INSERT INTO patrol_routes (id, name, checkpoints, estimated_duration, distance_km)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING *
  `, [routeId, data.name, JSON.stringify(processedCheckpoints), processedCheckpoints.length * 10, totalDistance]);
  
  return route;
}

async function getRoutes(): Promise<PatrolRoute[]> {
  const result = await pool.query('SELECT * FROM patrol_routes ORDER BY name');
  return result.rows.map(r => ({ ...r, checkpoints: JSON.parse(r.checkpoints) }));
}

async function getRouteById(id: string): Promise<PatrolRoute | null> {
  const result = await pool.query('SELECT * FROM patrol_routes WHERE id = $1', [id]);
  if (!result.rows[0]) return null;
  return { ...result.rows[0], checkpoints: JSON.parse(result.rows[0].checkpoints) };
}

// Haversine distance calculation
function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // km
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

function toRad(deg: number): number {
  return deg * (Math.PI / 180);
}

// ===========================================
// Patrol Execution
// ===========================================

async function startPatrol(officerId: string, routeId: string): Promise<Patrol> {
  const patrolId = uuidv4();
  
  const [patrol] = await pool.query(`
    INSERT INTO patrols (id, officer_id, route_id, status, start_time)
    VALUES ($1, $2, $3, 'in_progress', NOW())
    RETURNING *
  `, [patrolId, officerId, routeId]);
  
  // Start location tracking
  await redis.hset(`patrol:${patrolId}`, {
    status: 'in_progress',
    start_time: Date.now().toString(),
    checkpoints_visited: '0',
  });
  
  return patrol;
}

async function checkInCheckpoint(
  patrolId: string,
  checkpointId: string,
  latitude: number,
  longitude: number
): Promise<void> {
  const now = Date.now();
  
  // Verify location (within 50m of checkpoint)
  const checkpoint = await getCheckpointLocation(checkpointId);
  if (checkpoint) {
    const distance = calculateDistance(latitude, longitude, checkpoint.lat, checkpoint.lng);
    if (distance > 0.05) { // 50m
      throw new Error('Not at checkpoint location');
    }
  }
  
  // Record checkpoint visit
  await pool.query(`
    INSERT INTO patrol_checkpoints (id, patrol_id, checkpoint_id, checked_in_at, latitude, longitude)
    VALUES ($1, $2, $3, NOW(), $4, $5)
  `, [uuidv4(), patrolId, checkpointId, latitude, longitude]);
  
  // Update patrol stats
  await pool.query(`
    UPDATE patrols SET checkpoints_visited = checkpoints_visited + 1 WHERE id = $1
  `, [patrolId]);
  
  await redis.hincrby(`patrol:${patrolId}`, 'checkpoints_visited', 1);
}

async function updatePatrolLocation(
  patrolId: string,
  latitude: number,
  longitude: number,
  accuracy: number
): Promise<void> {
  const now = Date.now();
  
  // Store latest location
  await redis.geoadd(`patrols:locations`, longitude, latitude, patrolId);
  
  // Store in history
  await redis.lpush(`patrol:${patrolId}:location_history`, JSON.stringify({
    lat: latitude,
    lng: longitude,
    timestamp: now,
    accuracy,
  }));
  
  // Keep only last 1000 points
  await redis.ltrim(`patrol:${patrolId}:location_history`, 0, 999);
}

async function completePatrol(patrolId: string): Promise<void> {
  const endTime = Date.now();
  const startTime = await redis.hget(`patrol:${patrolId}`, 'start_time');
  const duration = startTime ? Math.round((endTime - parseInt(startTime)) / 60000) : 0;
  
  await pool.query(`
    UPDATE patrols SET status = 'completed', end_time = NOW(), 
      duration_minutes = $1, updated_at = NOW()
    WHERE id = $2
  `, [duration, patrolId]);
  
  await redis.hset(`patrol:${patrolId}`, { status: 'completed' });
}

async function abortPatrol(patrolId: string, reason: string): Promise<void> {
  await pool.query(`
    UPDATE patrols SET status = 'aborted', abort_reason = $1, end_time = NOW()
    WHERE id = $2
  `, [reason, patrolId]);
  
  await redis.hset(`patrol:${patrolId}`, { status: 'aborted' });
}

// ===========================================
// Real-Time Tracking
// ===========================================

async function getActivePatrols(): Promise<Patrol[]> {
  const result = await pool.query(`
    SELECT p.*, o.first_name, o.last_name, r.name as route_name
    FROM patrols p
    JOIN officers o ON p.officer_id = o.id
    JOIN patrol_routes r ON p.route_id = r.id
    WHERE p.status = 'in_progress'
    ORDER BY p.start_time DESC
  `);
  return result.rows;
}

async function getPatrolLocation(patrolId: string): Promise<{ lat: number; lng: number } | null> {
  const location = await redis.geopos(`patrols:locations`, patrolId);
  if (!location[0]) return null;
  return { lat: parseFloat(location[0][1]), lng: parseFloat(location[0][0]) };
}

async function getPatrolHistory(officerId: string): Promise<Patrol[]> {
  const result = await pool.query(`
    SELECT p.*, r.name as route_name
    FROM patrols p
    JOIN patrol_routes r ON p.route_id = r.id
    WHERE p.officer_id = $1
    ORDER BY p.start_time DESC
    LIMIT 50
  `, [officerId]);
  return result.rows;
}

// ===========================================
// Checkpoint Management
// ===========================================

async function getCheckpointLocation(checkpointId: string): Promise<{ lat: number; lng: number } | null> {
  const routes = await getRoutes();
  for (const route of routes) {
    const cp = route.checkpoints.find(c => c.id === checkpointId);
    if (cp) return { lat: cp.latitude, lng: cp.longitude };
  }
  return null;
}

async function scanCheckpoint(
  patrolId: string,
  checkpointId: string,
  qrCode: string,
  notes?: string
): Promise<void> {
  await pool.query(`
    INSERT INTO checkpoint_scans (id, patrol_id, checkpoint_id, qr_code, notes, scanned_at)
    VALUES ($1, $2, $3, $4, $5, NOW())
  `, [uuidv4(), patrolId, checkpointId, qrCode, notes]);
}

// ===========================================
// Analytics
// ===========================================

async function getPatrolAnalytics(dateRange?: { from: string; to: string }): Promise<{
  total_patrols: number;
  completed: number;
  aborted: number;
  total_distance: number;
  avg_duration: number;
  checkpoint_compliance: number;
}> {
  let query = 'SELECT * FROM patrols WHERE 1=1';
  const params: any[] = [];
  
  if (dateRange?.from) {
    params.push(dateRange.from);
    query += ` AND start_time >= $${params.length}`;
  }
  if (dateRange?.to) {
    params.push(dateRange.to);
    query += ` AND start_time <= $${params.length}`;
  }
  
  const patrols = await pool.query(query, params);
  
  const completed = patrols.rows.filter(p => p.status === 'completed').length;
  const aborted = patrols.rows.filter(p => p.status === 'aborted').length;
  const totalDistance = patrols.rows.reduce((sum, p) => sum + (p.total_distance || 0), 0);
  const avgDuration = patrols.rows.reduce((sum, p) => sum + (p.duration_minutes || 0), 0) / patrols.rows.length;
  
  // Checkpoint compliance
  const checkpointsVisited = patrols.rows.reduce((sum, p) => sum + (p.checkpoints_visited || 0), 0);
  const checkpointsExpected = patrols.rows.length * 10; // Assume 10 per patrol
  const compliance = checkpointsExpected > 0 ? (checkpointsVisited / checkpointsExpected) * 100 : 100;
  
  return {
    total_patrols: patrols.rows.length,
    completed,
    aborted,
    total_distance: Math.round(totalDistance),
    avg_duration: Math.round(avgDuration),
    checkpoint_compliance: Math.round(compliance),
  };
}

// ===========================================
// API Routes
// ===========================================

app.post('/api/routes', async (req: Request, res: Response) => {
  try {
    const route = await createRoute(req.body);
    res.status(201).json({ success: true, data: route });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to create route' });
  }
});

app.get('/api/routes', async (req: Request, res: Response) => {
  try {
    const routes = await getRoutes();
    res.json({ success: true, data: routes });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch routes' });
  }
});

app.get('/api/routes/:id', async (req: Request, res: Response) => {
  try {
    const route = await getRouteById(req.params.id);
    if (!route) return res.status(404).json({ error: 'Route not found' });
    res.json({ success: true, data: route });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch route' });
  }
});

app.post('/api/patrols/start', async (req: Request, res: Response) => {
  try {
    const { officer_id, route_id } = req.body;
    const patrol = await startPatrol(officer_id, route_id);
    res.status(201).json({ success: true, data: patrol });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to start patrol' });
  }
});

app.post('/api/patrols/:id/checkpoint', async (req: Request, res: Response) => {
  try {
    const { checkpoint_id, latitude, longitude } = req.body;
    await checkInCheckpoint(req.params.id, checkpoint_id, latitude, longitude);
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ success: false, error: (error as Error).message });
  }
});

app.post('/api/patrols/:id/location', async (req: Request, res: Response) => {
  try {
    const { latitude, longitude, accuracy } = req.body;
    await updatePatrolLocation(req.params.id, latitude, longitude, accuracy);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to update location' });
  }
});

app.post('/api/patrols/:id/complete', async (req: Request, res: Response) => {
  try {
    await completePatrol(req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to complete patrol' });
  }
});

app.get('/api/patrols/active', async (req: Request, res: Response) => {
  try {
    const patrols = await getActivePatrols();
    res.json({ success: true, data: patrols });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch patrols' });
  }
});

app.get('/api/patrols/:id/location', async (req: Request, res: Response) => {
  try {
    const location = await getPatrolLocation(req.params.id);
    res.json({ success: true, data: location });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch location' });
  }
});

app.get('/api/patrols/officer/:id', async (req: Request, res: Response) => {
  try {
    const history = await getPatrolHistory(req.params.id);
    res.json({ success: true, data: history });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch history' });
  }
});

app.get('/api/analytics', async (req: Request, res: Response) => {
  try {
    const analytics = await getPatrolAnalytics(req.query as any);
    res.json({ success: true, data: analytics });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch analytics' });
  }
});

app.get('/health', async (req: Request, res: Response) => {
  res.json({ status: 'healthy', service: 'patrol-management' });
});

const PORT = process.env.PORT || 3053;

app.listen(PORT, () => console.log(`Patrol Management Service on port ${PORT}`));

export default app;