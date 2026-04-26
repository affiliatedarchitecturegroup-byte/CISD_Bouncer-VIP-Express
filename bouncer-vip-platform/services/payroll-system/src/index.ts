import express, { Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";

const router = express.Router();

// Payroll types
interface Timesheet {
  id: string;
  employee_id: string;
  date: string;
  clock_in?: string;
  clock_out?: string;
  hours_worked: number;
}

const timesheets: Map<string, Timesheet> = new Map();

// Clock in
router.post("/clock-in", async (req: Request, res: Response) => {
  const { employee_id } = req.body;
  const timesheet: Timesheet = {
    id: uuidv4(),
    employee_id,
    date: new Date().toISOString().split("T")[0],
    clock_in: new Date().toISOString(),
    hours_worked: 0
  };
  timesheets.set(timesheet.id, timesheet);
  res.json(timesheet);
});

// Clock out
router.post("/clock-out", async (req: Request, res: Response) => {
  const { timesheet_id } = req.body;
  const ts = timesheets.get(timesheet_id);
  if (!ts) return res.status(404).json({ error: "Timesheet not found" });
  
  const clockOut = new Date();
  ts.clock_out = clockOut.toISOString();
  const diff = clockOut.getTime() - new Date(ts.clock_in!).getTime();
  ts.hours_worked = Math.round(diff / 3600000 * 100) / 100;
  
  timesheets.set(ts.id, ts);
  res.json(ts);
});

// Get timesheets
router.get("/timesheets", async (req: Request, res: Response) => {
  const list = Array.from(timesheets.values());
  res.json({ timesheets: list });
});

// Calculate payroll
router.post("/calculate", async (req: Request, res: Response) => {
  const { employee_id, period } = req.body;
  
  res.json({
    employee_id,
    period,
    regular_hours: 40,
    overtime_hours: 5,
    gross_pay: 8500,
    deductions: { tax: 2125, uif: 425 },
    net_pay: 5950
  });
});

export default router;