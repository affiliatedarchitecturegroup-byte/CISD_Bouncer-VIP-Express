// ===========================================
// Computer Vision Service
// CCTV AI analysis, object detection, anomaly detection
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

type CameraStatus = 'active' | 'inactive' | 'error';
type AlertSeverity = 'low' | 'medium' | 'high' | 'critical';

interface Camera {
  id: string;
  venue_id: string;
  name: string;
  location: string;
  ip_address: string;
  status: CameraStatus;
  stream_url: string;
  ai_enabled: boolean;
}

interface Detection {
  id: string;
  camera_id: string;
  timestamp: string;
  detections: DetectionResult[];
  alert_triggered: boolean;
}

interface DetectionResult {
  class: string;
  confidence: number;
  bbox: { x: number; y: number; w: number; h: number };
}

interface Alert {
  id: string;
  camera_id: string;
  type: string;
  severity: AlertSeverity;
  description: string;
  timestamp: string;
  acknowledged: boolean;
}

// ===========================================
// Camera Management
// ===========================================

async function registerCamera(data: {
  venue_id: string;
  name: string;
  location: string;
  ip_address: string;
  stream_url: string;
}): Promise<Camera> {
  const id = uuidv4();
  
  const [camera] = await pool.query(`
    INSERT INTO cameras (id, venue_id, name, location, ip_address, stream_url, status, ai_enabled)
    VALUES ($1, $2, $3, $4, $5, $6, 'active', true)
    RETURNING *
  `, [id, data.venue_id, data.name, data.location, data.ip_address, data.stream_url]);
  
  return camera;
}

async function getCameras(venueId?: string): Promise<Camera[]> {
  let query = 'SELECT * FROM cameras WHERE 1=1';
  const params: any[] = [];
  
  if (venueId) {
    params.push(venueId);
    query += ` AND venue_id = $${params.length}`;
  }
  
  const result = await pool.query(query, params);
  return result.rows;
}

async function getCameraById(id: string): Promise<Camera | null> {
  const result = await pool.query('SELECT * FROM cameras WHERE id = $1', [id]);
  return result.rows[0] || null;
}

// ===========================================
// AI Detection
// ===========================================

// Object classes for detection
const DETECTION_CLASSES = {
  person: { risk: 'low', alert: false },
  weapon: { risk: 'critical', alert: true },
  vehicle: { risk: 'medium', alert: false },
  bag: { risk: 'medium', alert: true },
  crowd: { risk: 'high', alert: true },
  fight: { risk: 'critical', alert: true },
  fire: { risk: 'critical', alert: true },
  smoke: { risk: 'high', alert: true },
  weapon_detected: { risk: 'critical', alert: true },
  unauthorized_person: { risk: 'high', alert: true },
  trespasser: { risk: 'medium', alert: true },
  suspicious_behavior: { risk: 'high', alert: true },
};

async function analyzeFrame(cameraId: string, frameData: string): Promise<Detection> {
  const id = uuidv4();
  const timestamp = new Date().toISOString();
  
  // In production, this would call TensorFlow/OpenCV
  // Simulated detection
  const detections: DetectionResult[] = [
    { class: 'person', confidence: 0.95, bbox: { x: 100, y: 150, w: 50, h: 180 } },
    { class: 'person', confidence: 0.87, bbox: { x: 300, y: 200, w: 45, h: 170 } },
  ];
  
  // Check for alert conditions
  let alertTriggered = false;
  for (const det of detections) {
    const config = DETECTION_CLASSES[det.class as keyof typeof DETECTION_CLASSES];
    if (config?.alert && det.confidence > 0.7) {
      alertTriggered = true;
      await createAlert(cameraId, det.class, config.risk, `${det.class} detected with ${Math.round(det.confidence * 100)}% confidence`);
    }
  }
  
  // Store detection
  await pool.query(`
    INSERT INTO detections (id, camera_id, timestamp, detections, alert_triggered)
    VALUES ($1, $2, $3, $4, $5)
  `, [id, cameraId, timestamp, JSON.stringify(detections), alertTriggered]);
  
  return { id, camera_id: cameraId, timestamp, detections, alert_triggered: alertTriggered };
}

async function createAlert(
  cameraId: string,
  type: string,
  severity: AlertSeverity,
  description: string
): Promise<Alert> {
  const id = uuidv4();
  
  const [alert] = await pool.query(`
    INSERT INTO cv_alerts (id, camera_id, type, severity, description, timestamp)
    VALUES ($1, $2, $3, $4, $5, NOW())
    RETURNING *
  `, [id, cameraId, type, severity, description]);
  
  // Publish to notification system
  await redis.lpush('alerts:queue', JSON.stringify({
    alertId: id,
    cameraId,
    type,
    severity,
    description,
  }));
  
  return alert;
}

// ===========================================
// Face Detection
// ===========================================

interface FaceDetection {
  face_id: string;
  bounding_box: { x: number; y: number; w: number; h: number };
  landmarks: { eyes: any; nose: any; mouth: any };
  embeddings: number[];
  matched_officer_id?: string;
  confidence?: number;
}

async function detectFaces(cameraId: string, frameData: string): Promise<FaceDetection[]> {
  // In production, use face_recognition or similar
  // Simulated
  return [];
}

async function matchFace(embedding: number[]): Promise<{ officerId: string; confidence: number } | null> {
  // Compare against known officer embeddings
  // In production, use vector similarity search
  return null;
}

// ===========================================
// Crowd Analysis
// ===========================================

interface CrowdMetrics {
  count: number;
  density: number; // people per sq meter
  flow_rate: number; // people per minute
  bottlenecks: { x: number; y: number; severity: number }[];
}

async function analyzeCrowd(cameraId: string): Promise<CrowdMetrics> {
  // Get recent detections
  const recent = await pool.query(`
    SELECT detections FROM detections 
    WHERE camera_id = $1 
    AND timestamp > NOW() - INTERVAL '5 minutes'
    ORDER BY timestamp
  `, [cameraId]);
  
  // Calculate metrics
  const counts = recent.rows.map(r => {
    const dets = JSON.parse(r.detections);
    return dets.filter((d: any) => d.class === 'person').length;
  });
  
  const avgCount = counts.length > 0 ? counts.reduce((a, b) => a + b, 0) / counts.length : 0;
  
  return {
    count: Math.round(avgCount),
    density: avgCount / 100, // Assume 100 sqm view
    flow_rate: counts.length > 1 ? Math.abs(counts[counts.length - 1] - counts[0]) : 0,
    bottlenecks: [],
  };
}

// ===========================================
// Anomaly Detection
// ===========================================

interface Anomaly {
  type: 'motion' | 'stillness' | 'direction' | 'speed';
  timestamp: string;
  severity: AlertSeverity;
  description: string;
}

async function detectAnomalies(cameraId: string): Promise<Anomaly[]> {
  const anomalies: Anomaly[] = [];
  
  // Get motion history
  const motionHistory = await pool.query(`
    SELECT detections FROM detections 
    WHERE camera_id = $1 
    AND timestamp > NOW() - INTERVAL '10 minutes'
    ORDER BY timestamp
  `, [cameraId]);
  
  if (motionHistory.rows.length === 0) return anomalies;
  
  // Check for unusual stillness
  const latestDetections = JSON.parse(motionHistory.rows[0].detections);
  if (latestDetections.length === 0) {
    anomalies.push({
      type: 'stillness',
      timestamp: new Date().toISOString(),
      severity: 'medium',
      description: 'No movement detected for extended period',
    });
  }
  
  return anomalies;
}

// ===========================================
// Heatmaps
// ===========================================

interface HeatmapPoint {
  x: number;
  y: number;
  intensity: number;
}

async function generateHeatmap(cameraId: string, duration: number = 3600): Promise<HeatmapPoint[]> {
  const detections = await pool.query(`
    SELECT detections FROM detections 
    WHERE camera_id = $1 
    AND timestamp > NOW() - INTERVAL '1 second' * $2
  `, [cameraId, duration]);
  
  const points: HeatmapPoint[] = [];
  
  for (const row of detections.rows) {
    const dets = JSON.parse(row.detections);
    for (const det of dets) {
      points.push({
        x: det.bbox.x + det.bbox.w / 2,
        y: det.bbox.y + det.bbox.h / 2,
        intensity: det.confidence,
      });
    }
  }
  
  return points;
}

// ===========================================
// Alerts
// ===========================================

async function getAlerts(filters?: {
  camera_id?: string;
  severity?: AlertSeverity;
  acknowledged?: boolean;
}): Promise<Alert[]> {
  let query = 'SELECT * FROM cv_alerts WHERE 1=1';
  const params: any[] = [];
  
  if (filters?.camera_id) {
    params.push(filters.camera_id);
    query += ` AND camera_id = $${params.length}`;
  }
  if (filters?.severity) {
    params.push(filters.severity);
    query += ` AND severity = $${params.length}`;
  }
  if (filters?.acknowledged !== undefined) {
    params.push(filters.acknowledged);
    query += ` AND acknowledged = $${params.length}`;
  }
  
  query += ' ORDER BY timestamp DESC LIMIT 100';
  const result = await pool.query(query, params);
  return result.rows;
}

async function acknowledgeAlert(alertId: string): Promise<void> {
  await pool.query(`
    UPDATE cv_alerts SET acknowledged = true, acknowledged_at = NOW() WHERE id = $1
  `, [alertId]);
}

// ===========================================
// API Routes
// ===========================================

app.post('/api/cameras', async (req: Request, res: Response) => {
  try {
    const camera = await registerCamera(req.body);
    res.status(201).json({ success: true, data: camera });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to register camera' });
  }
});

app.get('/api/cameras', async (req: Request, res: Response) => {
  try {
    const { venue_id } = req.query as any;
    const cameras = await getCameras(venue_id);
    res.json({ success: true, data: cameras });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch cameras' });
  }
});

app.get('/api/cameras/:id', async (req: Request, res: Response) => {
  try {
    const camera = await getCameraById(req.params.id);
    if (!camera) return res.status(404).json({ error: 'Camera not found' });
    res.json({ success: true, data: camera });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch camera' });
  }
});

app.post('/api/analyze/:cameraId', async (req: Request, res: Response) => {
  try {
    const { frame_data } = req.body;
    const result = await analyzeFrame(req.params.cameraId, frame_data);
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Analysis failed' });
  }
});

app.get('/api/crowd/:cameraId', async (req: Request, res: Response) => {
  try {
    const metrics = await analyzeCrowd(req.params.cameraId);
    res.json({ success: true, data: metrics });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Analysis failed' });
  }
});

app.get('/api/anomalies/:cameraId', async (req: Request, res: Response) => {
  try {
    const anomalies = await detectAnomalies(req.params.cameraId);
    res.json({ success: true, data: anomalies });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Detection failed' });
  }
});

app.get('/api/heatmap/:cameraId', async (req: Request, res: Response) => {
  try {
    const { duration } = req.query;
    const heatmap = await generateHeatmap(req.params.cameraId, parseInt(duration as any) || 3600);
    res.json({ success: true, data: heatmap });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to generate heatmap' });
  }
});

app.get('/api/alerts', async (req: Request, res: Response) => {
  try {
    const alerts = await getAlerts(req.query as any);
    res.json({ success: true, data: alerts });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch alerts' });
  }
});

app.post('/api/alerts/:id/acknowledge', async (req: Request, res: Response) => {
  try {
    await acknowledgeAlert(req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to acknowledge' });
  }
});

app.get('/health', async (req: Request, res: Response) => {
  res.json({ status: 'healthy', service: 'computer-vision' });
});

const PORT = process.env.PORT || 3060;

app.listen(PORT, () => console.log(`Computer Vision Service on port ${PORT}`));

export default app;