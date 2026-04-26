import express, { Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";

const router = express.Router();

interface Staff {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  role: string;
  status: "active" | "inactive" | "terminated";
  hire_date: Date;
  certifications: string[];
  hourly_rate: number;
}

interface Shift {
  id: string;
  staff_id: string;
  date: string;
  start_time: string;
  end_time: string;
  role: string;
  status: "scheduled" | "completed" | "no_show" | "cancelled";
}

const staff: Map<string, Staff> = new Map();
const shifts: Map<string, Shift> = new Map();

// Add staff
router.post("/staff", async (req: Request, res: Response) => {
  const s: Staff = {
    id: uuidv4(),
    first_name: req.body.first_name,
    last_name: req.body.last_name,
    email: req.body.email,
    phone: req.body.phone,
    role: req.body.role,
    status: "active",
    hire_date: new Date(),
    certifications: req.body.certifications || [],
    hourly_rate: req.body.hourly_rate || 0
  };
  staff.set(s.id, s);
  res.status(201).json(s);
});

// Get all staff
router.get("/staff", async (req: Request, res: Response) => {
  const role = req.query.role as string;
  let staffList = Array.from(staff.values());
  if (role) staffList = staffList.filter(s => s.role === role);
  res.json({ staff: staffList });
});

// Create shift
router.post("/shifts", async (req: Request, res: Response) => {
  const shift: Shift = {
    id: uuidv4(),
    staff_id: req.body.staff_id,
    date: req.body.date,
    start_time: req.body.start_time,
    end_time: req.body.end_time,
    role: req.body.role,
    status: "scheduled"
  };
  shifts.set(shift.id, shift);
  res.status(201).json(shift);
});

// Get shifts
router.get("/shifts", async (req: Request, res: Response) => {
  const date = req.query.date as string;
  let shiftList = Array.from(shifts.values());
  if (date) shiftList = shiftList.filter(s => s.date === date);
  res.json({ shifts: shiftList });
});

// Complete shift
router.put("/shifts/:id/complete", async (req: Request, res: Response) => {
  const shift = shifts.get(req.params.id);
  if (!shift) return res.status(404).json({ error: "Shift not found" });
  shift.status = "completed";
  shifts.set(shift.id, shift);
  res.json(shift);
});

// Staff performance
router.get("/performance/:staff_id", async (req: Request, res: Response) => {
  const staffShifts = Array.from(shifts.values())
    .filter(s => s.staff_id === req.params.staff_id);
  
  const completed = staffShifts.filter(s => s.status === "completed").length;
  const noShows = staffShifts.filter(s => s.status === "no_show").length;
  
  res.json({
    total_shifts: staffShifts.length,
    completed,
    no_shows: noShows,
    completion_rate: staffShifts.length > 0 ? completed / staffShifts.length : 0
  });
});

export default router;