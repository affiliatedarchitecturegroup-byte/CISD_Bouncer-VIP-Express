import express, { Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";

const router = express.Router();

// Compliance types
interface License {
  id: string;
  employee_id: string;
  type: string;
  number: string;
  issued_date: Date;
  expiry_date: Date;
  status: "valid" | "expired" | "pending";
}

const licenses: Map<string, License> = new Map();

// Add license
router.post("/licenses", async (req: Request, res: Response) => {
  const license: License = {
    id: uuidv4(),
    employee_id: req.body.employee_id,
    type: req.body.type,
    number: req.body.number,
    issued_date: new Date(),
    expiry_date: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    status: "valid"
  };
  licenses.set(license.id, license);
  res.json(license);
});

// Get licenses
router.get("/licenses/:employee_id", async (req: Request, res: Response) => {
  const list = Array.from(licenses.values())
    .filter(l => l.employee_id === req.params.employee_id);
  res.json({ licenses: list });
});

// Expiring soon
router.get("/expiring-soon", async (req: Request, res: Response) => {
  const thirtyDays = Date.now() + 30 * 86400000;
  const expiring = Array.from(licenses.values())
    .filter(l => new Date(l.expiry_date).getTime() < thirtyDays);
  res.json({ expiring_soon: expiring });
});

export default router;