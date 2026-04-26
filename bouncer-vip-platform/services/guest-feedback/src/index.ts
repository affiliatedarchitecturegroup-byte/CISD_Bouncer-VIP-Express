import express, { Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";

const router = express.Router();

// Feedback types
interface Feedback {
  id: string;
  guest_id: string;
  type: "complaint" | "suggestion" | "compliment";
  message: string;
  status: "open" | "in_progress" | "resolved";
  response?: string;
  created_at: Date;
}

const feedback: Map<string, Feedback> = new Map();

// Submit feedback
router.post("/", async (req: Request, res: Response) => {
  const f: Feedback = {
    id: uuidv4(),
    guest_id: req.body.guest_id,
    type: req.body.type,
    message: req.body.message,
    status: "open",
    created_at: new Date()
  };
  feedback.set(f.id, f);
  res.json(f);
});

// Get feedback
router.get("/", async (req: Request, res: Response) => {
  const list = Array.from(feedback.values())
    .sort((a, b) => b.created_at.getTime() - a.created_at.getTime());
  res.json({ feedback: list });
});

// Respond to feedback
router.put("/:id/respond", async (req: Request, res: Response) => {
  const f = feedback.get(req.params.id);
  if (!f) return res.status(404).json({ error: "Feedback not found" });
  
  f.response = req.body.response;
  f.status = "resolved";
  feedback.set(f.id, f);
  res.json(f);
});

// Get feedback stats
router.get("/stats", async (req: Request, res: Response) => {
  const list = Array.from(feedback.values());
  res.json({
    total: list.length,
    open: list.filter(f => f.status === "open").length,
    resolved: list.filter(f => f.status === "resolved").length,
    by_type: {
      complaint: list.filter(f => f.type === "complaint").length,
      suggestion: list.filter(f => f.type === "suggestion").length,
      compliment: list.filter(f => f.type === "compliment").length
    }
  });
});

export default router;