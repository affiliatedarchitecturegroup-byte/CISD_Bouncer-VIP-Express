import express, { Request, Response } from "express";
import { Pool } from "pg";

const router = express.Router();
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

interface Reservation {
  id: string;
  guest_id: string;
  room_number: string;
  check_in: Date;
  check_out: Date;
  status: "confirmed" | "pending" | "cancelled";
  total_amount: number;
  special_requests?: string;
  created_at: Date;
}

router.get("/", async (req: Request, res: Response) => {
  try {
    const result = await pool.query<Reservation>(
      "SELECT * FROM reservations ORDER BY created_at DESC LIMIT 100"
    );
    res.json({
      status: "success",
      data: result.rows,
      count: result.rowCount,
    });
  } catch (error) {
    console.error("Error fetching reservations:", error);
    res.status(500).json({ status: "error", message: "Database error" });
  }
});

router.get("/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const result = await pool.query<Reservation>(
      "SELECT * FROM reservations WHERE id = $1",
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ status: "error", message: "Reservation not found" });
    }
    res.json({ status: "success", data: result.rows[0] });
  } catch (error) {
    console.error("Error fetching reservation:", error);
    res.status(500).json({ status: "error", message: "Database error" });
  }
});

router.post("/", async (req: Request, res: Response) => {
  try {
    const { guest_id, room_number, check_in, check_out, total_amount, special_requests } = req.body;
    const result = await pool.query<Reservation>(
      `INSERT INTO reservations (guest_id, room_number, check_in, check_out, total_amount, special_requests, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending')
       RETURNING *`,
      [guest_id, room_number, check_in, check_out, total_amount, special_requests]
    );
    res.status(201).json({ status: "success", data: result.rows[0] });
  } catch (error) {
    console.error("Error creating reservation:", error);
    res.status(500).json({ status: "error", message: "Database error" });
  }
});

router.put("/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { status, check_in, check_out } = req.body;
    const result = await pool.query<Reservation>(
      `UPDATE reservations SET status = COALESCE($1, status), check_in = COALESCE($2, check_in), check_out = COALESCE($3, check_out)
       WHERE id = $4 RETURNING *`,
      [status, check_in, check_out, id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ status: "error", message: "Reservation not found" });
    }
    res.json({ status: "success", data: result.rows[0] });
  } catch (error) {
    console.error("Error updating reservation:", error);
    res.status(500).json({ status: "error", message: "Database error" });
  }
});

router.delete("/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const result = await pool.query("DELETE FROM reservations WHERE id = $1 RETURNING id", [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ status: "error", message: "Reservation not found" });
    }
    res.json({ status: "success", message: "Reservation deleted" });
  } catch (error) {
    console.error("Error deleting reservation:", error);
    res.status(500).json({ status: "error", message: "Database error" });
  }
});

export default router;