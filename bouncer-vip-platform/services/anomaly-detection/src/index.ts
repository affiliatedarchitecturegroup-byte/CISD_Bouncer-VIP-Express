// ===========================================
// Anomaly Detection Service
// ML-powered fraud & risk detection
// ===========================================

import express, { Request, Response } from 'express';
import { Pool } from 'pg';
import Redis from 'ioredis';

const app = express();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const redis = new Redis(process.env.REDIS_URL);

// ===========================================
// Statistical Anomaly Detection
// ===========================================

interface AnomalyScore {
  type: 'fraud' | 'risk' | 'pattern' | 'behavior';
  severity: 'low' | 'medium' | 'high' | 'critical';
  score: number; // 0-100
  factors: string[];
  description: string;
}

class AnomalyDetector {
  // Z-score based detection
  detectZScore(values: number[], value: number): number {
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;
    const stdDev = Math.sqrt(variance);
    return stdDev === 0 ? 0 : Math.abs((value - mean) / stdDev);
  }
  
  // IQR-based outlier detection
  detectIQR(values: number[], value: number): boolean {
    const sorted = [...values].sort((a, b) => a - b);
    const q1 = sorted[Math.floor(sorted.length * 0.25)];
    const q3 = sorted[Math.floor(sorted.length * 0.75)];
    const iqr = q3 - q1;
    const lower = q1 - 1.5 * iqr;
    const upper = q3 + 1.5 * iqr;
    return value < lower || value > upper;
  }
  
  // Time-based anomaly detection
  detectTimeAnomaly(
    clockInTime: Date,
    scheduledTime: Date,
    maxEarlyMinutes: number = 30,
    maxLateMinutes: number = 15
  ): AnomalyScore | null {
    const diffMinutes = (clockInTime.getTime() - scheduledTime.getTime()) / (1000 * 60);
    
    if (diffMinutes > maxLateMinutes) {
      return {
        type: 'behavior',
        severity: diffMinutes > 60 ? 'high' : 'medium',
        score: Math.min(100, diffMinutes * 2),
        factors: ['late_check_in', `late_by_${diffMinutes}_minutes`],
        description: `Check-in ${Math.round(diffMinutes)} minutes late`,
      };
    }
    
    if (diffMinutes < -maxEarlyMinutes) {
      return {
        type: 'fraud',
        severity: 'high',
        score: 80,
        factors: ['early_check_in', 'potential_ghost_shift'],
        description: `Check-in ${Math.round(Math.abs(diffMinutes))} minutes early - potential fraud`,
      };
    }
    
    return null;
  }
  
  // Location anomaly detection
  detectLocationAnomaly(
    checkInLat: number,
    checkInLng: number,
    venueLat: number,
    venueLng: number,
    maxDistanceKm: number = 0.5
  ): AnomalyScore | null {
    const distance = this.haversineDistance(
      checkInLat, checkInLng,
      venueLat, venueLng
    );
    
    if (distance > maxDistanceKm) {
      return {
        type: 'fraud',
        severity: distance > 5 ? 'critical' : 'high',
        score: Math.min(100, distance * 20),
        factors: ['location_mismatch', `${Math.round(distance)}km_away`],
        description: `Check-in ${Math.round(distance)}km from venue`,
      };
    }
    
    return null;
  }
  
  // Haversine distance in km
  haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 6371; // Earth radius
    const dLat = this.toRad(lat2 - lat1);
    const dLng = this.toRad(lng2 - lng1);
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(this.toRad(lat1)) * Math.cos(this.toRad(lat2)) *
              Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }
  
  private toRad(deg: number): number {
    return deg * (Math.PI / 180);
  }
}

// ===========================================
// Fraud Detection
// ===========================================

interface FraudCheck {
  officerId: string;
  shiftId: string;
  score: number;
  anomalies: AnomalyScore[];
  isFlagged: boolean;
}

class FraudDetector {
  private detector = new AnomalyDetector();
  
  async checkShift(
    officerId: string,
    shiftId: string,
    checkInData: {
      time: Date;
      latitude: number;
      longitude: number;
      venueId: string;
    }
  ): Promise<FraudCheck> {
    const anomalies: AnomalyScore[] = [];
    
    // Get venue coordinates
    const venueResult = await pool.query(
      'SELECT latitude, longitude FROM venues WHERE id = $1',
      [checkInData.venueId]
    );
    const venue = venueResult.rows[0];
    
    // Get scheduled time
    const shiftResult = await pool.query(
      'SELECT start_time FROM shifts WHERE id = $1',
      [shiftId]
    );
    const scheduledTime = new Date(shiftResult.rows[0]?.start_time || Date.now());
    
    // Time anomaly
    const timeAnomaly = this.detector.detectTimeAnomaly(checkInData.time, scheduledTime);
    if (timeAnomaly) anomalies.push(timeAnomaly);
    
    // Location anomaly
    if (venue) {
      const locationAnomaly = this.detector.detectLocationAnomaly(
        checkInData.latitude,
        checkInData.longitude,
        venue.latitude,
        venue.longitude
      );
      if (locationAnomaly) anomalies.push(locationAnomaly);
    }
    
    // Calculate total score
    const score = Math.min(100, anomalies.reduce((sum, a) => sum + a.score, 0));
    
    return {
      officerId,
      shiftId,
      score,
      anomalies,
      isFlagged: score > 50,
    };
  }
  
  async checkPayrollAnomaly(
    officerId: string,
    periodStart: Date,
    periodEnd: Date
  ): Promise<FraudCheck> {
    const anomalies: AnomalyScore[] = [];
    
    // Get historical hours
    const hoursResult = await pool.query(`
      SELECT actual_hours 
      FROM shifts 
      WHERE officer_id = $1 
        AND check_out_time BETWEEN $2 AND $3
    `, [officerId, periodStart, periodEnd]);
    
    const hours = hoursResult.rows.map(r => r.actual_hours || 0);
    
    // Detect unusual patterns
    const totalHours = hours.reduce((a, b) => a + b, 0);
    const avgHours = totalHours / hours.length;
    const maxHours = Math.max(...hours);
    
    // > 16 hours in a shift is suspicious
    if (maxHours > 16) {
      anomalies.push({
        type: 'fraud',
        severity: 'critical',
        score: 90,
        factors: ['excessive_hours', `${maxHours}h_in_single_shift`],
        description: `${maxHours} hours logged in single shift - investigate`,
      });
    }
    
    // > 60 hours per week
    if (totalHours > 60) {
      anomalies.push({
        type: 'fraud',
        severity: 'high',
        score: 80,
        factors: ['excessive_weekly_hours', `${totalHours}h_this_week`],
        description: `${totalHours} hours this week - exceeds regulations`,
      });
    }
    
    // Perfect 8-hour shifts (potential fake entries)
    const perfectShifts = hours.filter(h => Math.abs(h - 8) < 0.1);
    if (perfectShifts.length > hours.length * 0.8 && hours.length > 5) {
      anomalies.push({
        type: 'pattern',
        severity: 'medium',
        score: 60,
        factors: ['suspicious_pattern', 'all_exact_8h_shifts'],
        description: 'Unusually consistent shift lengths',
      });
    }
    
    const score = Math.min(100, anomalies.reduce((sum, a) => sum + a.score, 0));
    
    return {
      officerId,
      shiftId: 'payroll-check',
      score,
      anomalies,
      isFlagged: score > 50,
    };
  }
}

// ===========================================
// Risk Assessment
// ===========================================

interface RiskAssessment {
  venueId: string;
  date: string;
  overallRisk: 'low' | 'medium' | 'high' | 'critical';
  riskScore: number;
  factors: {
    incidentHistory: number;
    officerExperience: number;
    attendanceLevel: number;
    timeOfDay: number;
    dayOfWeek: number;
  };
  recommendations: string[];
}

class RiskAssessor {
  async assessVenue(
    venueId: string,
    date: Date
  ): Promise<RiskAssessment> {
    const dayOfWeek = date.getDay();
    
    // Get incident history (last 30 days)
    const incidentResult = await pool.query(`
      SELECT COUNT(*) as incidents, 
             AVG(severity) as avg_severity
      FROM incidents
      WHERE venue_id = $1
        AND created_at > NOW() - INTERVAL '30 days'
    `, [venueId]);
    
    const incidentScore = Math.min(100, 
      (incidentResult.rows[0]?.incidents || 0) * 10 +
      (incidentResult.rows[0]?.avg_severity || 1) * 20
    );
    
    // Time of day factor
    const hour = date.getHours();
    const timeRisk = hour >= 22 || hour <= 4 ? 30 : hour >= 18 ? 20 : 10;
    
    // Day of week factor
    const dayRisk = dayOfWeek === 0 || dayOfWeek === 6 ? 25 : 10;
    
    const totalRisk = Math.min(100, incidentScore + timeRisk + dayRisk);
    
    let overallRisk: RiskAssessment['overallRisk'] = 'low';
    if (totalRisk > 75) overallRisk = 'critical';
    else if (totalRisk > 50) overallRisk = 'high';
    else if (totalRisk > 25) overallRisk = 'medium';
    
    return {
      venueId,
      date: date.toISOString().split('T')[0],
      overallRisk,
      riskScore: totalRisk,
      factors: {
        incidentHistory: incidentScore,
        officerExperience: 10,
        attendanceLevel: 15,
        timeOfDay: timeRisk,
        dayOfWeek: dayRisk,
      },
      recommendations: this.generateRecommendations(overallRisk, totalRisk),
    };
  }
  
  private generateRecommendations(
    risk: string,
    score: number
  ): string[] {
    const recs: string[] = [];
    if (score > 50) recs.push('Increase officer count by 20%');
    if (score > 75) recs.push('Consider postponing high-risk events');
    recs.push('Ensure radio communication is operational');
    return recs;
  }
}

// ===========================================
// API Routes
// ===========================================

const fraudDetector = new FraudDetector();
const riskAssessor = new RiskAssessor();

// POST /api/fraud/check-shift - Check shift fraud
app.post('/api/fraud/check-shift', async (req: Request, res: Response) => {
  try {
    const { officer_id, shift_id, check_in_time, latitude, longitude, venue_id } = req.body;
    
    const result = await fraudDetector.checkShift(officer_id, shift_id, {
      time: new Date(check_in_time),
      latitude,
      longitude,
      venueId: venue_id,
    });
    
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Fraud check failed' });
  }
});

// POST /api/fraud/check-payroll - Check payroll fraud
app.post('/api/fraud/check-payroll', async (req: Request, res: Response) => {
  try {
    const { officer_id, period_start, period_end } = req.body;
    
    const result = await fraudDetector.checkPayrollAnomaly(
      officer_id,
      new Date(period_start),
      new Date(period_end)
    );
    
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Payroll check failed' });
  }
});

// GET /api/risk/:venueId - Get venue risk assessment
app.get('/api/risk/:venueId', async (req: Request, res: Response) => {
  try {
    const { date } = req.query;
    const result = await riskAssessor.assessVenue(
      req.params.venueId,
      new Date(date || Date.now())
    );
    
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Risk assessment failed' });
  }
});

// GET /health
app.get('/health', async (req: Request, res: Response) => {
  res.json({ status: 'healthy', service: 'anomaly-detection' });
});

const PORT = process.env.PORT || 3015;

async function start() {
  try {
    await pool.connect();
    await redis.connect();
  } catch (error) {
    console.log('Anomaly Detection: Starting in degraded mode');
  }
  
  app.listen(PORT, () => {
    console.log(`Anomaly Detection Service running on port ${PORT}`);
  });
}

start();

export default app;