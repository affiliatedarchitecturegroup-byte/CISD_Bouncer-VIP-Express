// ===========================================
// Predictive Scheduling Service
// ML-based intelligent shift scheduling
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
// Types
// ===========================================

interface Officer {
  id: string;
  grade: 'A' | 'B' | 'C' | 'D' | 'E';
  skills: string[];
  availability: Record<string, string[]>;
  maxHoursPerWeek: number;
  preferredShifts: string[];
}

interface ShiftRequirement {
  venueId: string;
  date: string;
  startTime: string;
  endTime: string;
  officerCount: number;
  minGrade: 'A' | 'B' | 'C' | 'D' | 'E';
  requiredSkills: string[];
}

interface Schedule {
  id: string;
  weekStart: string;
  shifts: ScheduledShift[];
  optimization_score: number;
}

interface ScheduledShift {
  id: string;
  officerId: string;
  venueId: string;
  date: string;
  startTime: string;
  endTime: string;
  score: number;
}

// ===========================================
// Optimization Engine
// ===========================================

const GRADE_HIERARCHY = { A: 5, B: 4, C: 3, D: 2, E: 1 };

class SchedulingOptimizer {
  // Calculate officer suitability for a shift
  calculateSuitability(officer: Officer, requirement: ShiftRequirement): number {
    let score = 50; // Base score
    
    // Grade match (higher grade = better)
    const officerGradeValue = GRADE_HIERARCHY[officer.grade];
    const requiredGradeValue = GRADE_HIERARCHY[requirement.minGrade];
    if (officerGradeValue >= requiredGradeValue) {
      score += 20;
    } else {
      score -= 30;
    }
    
    // Skills match
    const requiredSkills = requirement.requiredSkills || [];
    const matchingSkills = requiredSkills.filter(s => officer.skills.includes(s));
    score += matchingSkills.length * 10;
    
    // Availability
    const dayOfWeek = new Date(requirement.date).getDay();
    const dayAvailability = officer.availability[dayOfWeek] || [];
    if (dayAvailability.includes(requirement.startTime)) {
      score += 15;
    }
    
    // Preference
    if (officer.preferredShifts.includes(requirement.venueId)) {
      score += 10;
    }
    
    // Workload balance (prefer less worked officers)
    // Would check actual hours worked
    
    return Math.max(0, Math.min(100, score));
  }
  
  // Optimize schedule using greedy algorithm
  optimizeSchedule(officers: Officer[], requirements: ShiftRequirement[]): ScheduledShift[] {
    const shifts: ScheduledShift[] = [];
    
    // Sort requirements by priority (highest officer count first)
    const sortedRequirements = [...requirements].sort((a, b) => b.officerCount - a.officerCount);
    
    for (const req of sortedRequirements) {
      // Find available officers
      const availableOfficers = officers
        .map(o => ({
          officer: o,
          score: this.calculateSuitability(o, req),
        }))
        .filter(o => o.score > 30)
        .sort((a, b) => b.score - a.score);
      
      // Assign officers
      for (let i = 0; i < req.officerCount && i < availableOfficers.length; i++) {
        const { officer, score } = availableOfficers[i];
        
        shifts.push({
          id: uuidv4(),
          officerId: officer.id,
          venueId: req.venueId,
          date: req.date,
          startTime: req.startTime,
          endTime: req.endTime,
          score,
        });
      }
    }
    
    return shifts;
  }
  
  // Calculate optimization metrics
  calculateMetrics(shifts: ScheduledShift[], officers: Officer[]): {
    coverage_rate: number;
    skill_match_rate: number;
    avg_suitability_score: number;
    unassigned_positions: number;
  } {
    const totalRequired = shifts.length;
    const assigned = shifts.length;
    
    const avgScore = shifts.reduce((sum, s) => sum + s.score, 0) / (shifts.length || 1);
    
    return {
      coverage_rate: Math.round((assigned / totalRequired) * 100),
      skill_match_rate: Math.round(shifts.filter(s => s.score > 70).length / (shifts.length || 1) * 100),
      avg_suitability_score: Math.round(avgScore),
      unassigned_positions: 0,
    };
  }
}

const optimizer = new SchedulingOptimizer();

// ===========================================
// Schedule Generation
// ===========================================

async function generateSchedule(weekStart: string): Promise<Schedule> {
  // Get officers
  const officersResult = await pool.query(`
    SELECT id, grade, skills, availability, max_hours_per_week, preferred_shifts
    FROM officers WHERE status = 'active'
  `);
  
  const officers: Officer[] = officersResult.rows.map(o => ({
    id: o.id,
    grade: o.grade,
    skills: o.skills || [],
    availability: o.availability || {},
    maxHoursPerWeek: o.max_hours_per_week || 40,
    preferredShifts: o.preferred_shifts || [],
  }));
  
  // Get shift requirements for the week
  const requirements: ShiftRequirement[] = [];
  
  for (let i = 0; i < 7; i++) {
    const date = new Date(weekStart);
    date.setDate(date.getDate() + i);
    const dateStr = date.toISOString().split('T')[0];
    
    // Get forecasted demand
    const demand = await getForecastedDemand(dateStr);
    
    for (const d of demand) {
      requirements.push({
        venueId: d.venue_id,
        date: dateStr,
        startTime: d.start_time,
        endTime: d.end_time,
        officerCount: d.officers_needed,
        minGrade: d.min_grade || 'C',
        requiredSkills: d.required_skills || [],
      });
    }
  }
  
  // Optimize
  const shifts = optimizer.optimizeSchedule(officers, requirements);
  const metrics = optimizer.calculateMetrics(shifts, officers);
  
  // Store schedule
  const scheduleId = uuidv4();
  await pool.query(`
    INSERT INTO schedules (id, week_start, shifts, metrics, status)
    VALUES ($1, $2, $3, $4, 'draft')
  `, [scheduleId, weekStart, JSON.stringify(shifts), JSON.stringify(metrics)]);
  
  return {
    id: scheduleId,
    weekStart,
    shifts,
    optimization_score: metrics.avg_suitability_score,
  };
}

async function getForecastedDemand(date: string): Promise<any[]> {
  // Get demand forecast for date
  const result = await pool.query(`
    SELECT venue_id, start_time, end_time, officers_needed, min_grade, required_skills
    FROM shift_forecasts
    WHERE date = $1
  `, [date]);
  
  return result.rows;
}

// ===========================================
// Schedule Management
// ===========================================

async function getSchedule(weekStart: string): Promise<Schedule | null> {
  const result = await pool.query(`
    SELECT * FROM schedules WHERE week_start = $1
  `, [weekStart]);
  
  if (!result.rows[0]) return null;
  
  return {
    ...result.rows[0],
    shifts: JSON.parse(result.rows[0].shifts),
  };
}

async function publishSchedule(scheduleId: string): Promise<void> {
  // Create actual shifts from schedule
  const schedule = await pool.query('SELECT * FROM schedules WHERE id = $1', [scheduleId]);
  const shifts = JSON.parse(schedule.rows[0].shifts);
  
  for (const shift of shifts) {
    await pool.query(`
      INSERT INTO shifts (id, officer_id, venue_id, start_time, end_time, status)
      VALUES ($1, $2, $3, $4, $5, 'scheduled')
    `, [shift.id, shift.officerId, shift.venueId, `${shift.date} ${shift.startTime}`, `${shift.date} ${shift.endTime}`]);
  }
  
  // Update status
  await pool.query(`
    UPDATE schedules SET status = 'published', published_at = NOW() WHERE id = $1
  `, [scheduleId]);
}

async function swapOfficers(shiftId1: string, shiftId2: string): Promise<void> {
  // Get shift details
  const [shift1, shift2] = await Promise.all([
    pool.query('SELECT * FROM shifts WHERE id = $1', [shiftId1]),
    pool.query('SELECT * FROM shifts WHERE id = $1', [shiftId2]),
  ]);
  
  // Swap officers
  await pool.query(`
    UPDATE shifts SET officer_id = $1 WHERE id = $2
  `, [shift2.rows[0].officer_id, shiftId1]);
  
  await pool.query(`
    UPDATE shifts SET officer_id = $1 WHERE id = $2
  `, [shift1.rows[0].officer_id, shiftId2]);
}

// ===========================================
// Conflict Detection
// ===========================================

interface Conflict {
  type: 'overlap' | 'overtime' | 'unavailable' | 'skill_gap';
  shiftId: string;
  officerId: string;
  description: string;
}

async function detectConflicts(scheduleId: string): Promise<Conflict[]> {
  const conflicts: Conflict[] = [];
  
  const schedule = await pool.query('SELECT * FROM schedules WHERE id = $1', [scheduleId]);
  const shifts = JSON.parse(schedule.rows[0].shifts);
  
  // Group shifts by officer
  const officerShifts: Record<string, any[]> = {};
  for (const shift of shifts) {
    if (!officerShifts[shift.officerId]) {
      officerShifts[shift.officerId] = [];
    }
    officerShifts[shift.officerId].push(shift);
  }
  
  // Check each officer
  for (const [officerId, officerShifts] of Object.entries(officerShifts)) {
    // Check overlaps
    for (let i = 0; i < officerShifts.length; i++) {
      for (let j = i + 1; j < officerShifts.length; j++) {
        if (this.shiftsOverlap(officerShifts[i], officerShifts[j])) {
          conflicts.push({
            type: 'overlap',
            shiftId: officerShifts[i].id,
            officerId,
            description: 'Shift overlap detected',
          });
        }
      }
    }
    
    // Check overtime
    const totalHours = this.calculateTotalHours(officerShifts);
    if (totalHours > 45) {
      conflicts.push({
        type: 'overtime',
        shiftId: officerShifts[0].id,
        officerId,
        description: `Exceeds max hours: ${totalHours}h`,
      });
    }
  }
  
  return conflicts;
}

private shiftsOverlap(shift1: any, shift2: any): boolean {
  if (shift1.date !== shift2.date) return false;
  
  const start1 = this.timeToMinutes(shift1.startTime);
  const end1 = this.timeToMinutes(shift1.endTime);
  const start2 = this.timeToMinutes(shift2.startTime);
  const end2 = this.timeToMinutes(shift2.endTime);
  
  return start1 < end2 && end1 > start2;
}

private timeToMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

private calculateTotalHours(shifts: any[]): number {
  let total = 0;
  for (const shift of shifts) {
    const start = this.timeToMinutes(shift.startTime);
    let end = this.timeToMinutes(shift.endTime);
    if (end < start) end += 24 * 60; // Handle overnight shifts
    total += (end - start) / 60;
  }
  return total;
}

// ===========================================
// API Routes
// ===========================================

app.post('/api/schedule/generate', async (req: Request, res: Response) => {
  try {
    const { week_start } = req.body;
    const schedule = await generateSchedule(week_start);
    res.json({ success: true, data: schedule });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to generate schedule' });
  }
});

app.get('/api/schedule/:weekStart', async (req: Request, res: Response) => {
  try {
    const schedule = await getSchedule(req.params.weekStart);
    if (!schedule) return res.status(404).json({ error: 'Schedule not found' });
    res.json({ success: true, data: schedule });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch schedule' });
  }
});

app.post('/api/schedule/:id/publish', async (req: Request, res: Response) => {
  try {
    await publishSchedule(req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to publish schedule' });
  }
});

app.post('/api/schedule/swap', async (req: Request, res: Response) => {
  try {
    const { shift1, shift2 } = req.body;
    await swapOfficers(shift1, shift2);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to swap officers' });
  }
});

app.get('/api/schedule/:id/conflicts', async (req: Request, res: Response) => {
  try {
    const conflicts = await detectConflicts(req.params.id);
    res.json({ success: true, data: conflicts });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to detect conflicts' });
  }
});

app.get('/health', async (req: Request, res: Response) => {
  res.json({ status: 'healthy', service: 'predictive-scheduling' });
});

const PORT = process.env.PORT || 3062;

app.listen(PORT, () => console.log(`Predictive Scheduling Service on port ${PORT}`));

export default app;