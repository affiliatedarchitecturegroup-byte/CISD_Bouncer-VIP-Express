import express, { Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";

const router = express.Router();

// Gamification types
interface Achievement {
  id: string;
  guest_id: string;
  badge_id: string;
  name: string;
  description: string;
  earned_at: Date;
}

interface Leaderboard {
  rankings: { guest_id: string; name: string; points: number; rank: number }[];
  period: string;
}

const achievements: Map<string, Achievement> = new Map();

// Earn achievement
router.post("/achievements", async (req: Request, res: Response) => {
  const achievement: Achievement = {
    id: uuidv4(),
    guest_id: req.body.guest_id,
    badge_id: req.body.badge_id,
    name: req.body.name,
    description: req.body.description,
    earned_at: new Date()
  };
  achievements.set(achievement.id, achievement);
  res.json(achievement);
});

// Get achievements
router.get("/achievements/:guest_id", async (req: Request, res: Response) => {
  const list = Array.from(achievements.values())
    .filter(a => a.guest_id === req.params.guest_id);
  res.json({ achievements: list });
});

// Leaderboard
router.get("/leaderboard", async (req: Request, res: Response) => {
  const leaderboard: Leaderboard = {
    rankings: [
      { guest_id: "g1", name: "John D.", points: 15420, rank: 1 },
      { guest_id: "g2", name: "Sarah M.", points: 12300, rank: 2 },
      { guest_id: "g3", name: "Mike R.", points: 10500, rank: 3 }
    ],
    period: "this_month"
  };
  res.json(leaderboard);
});

// Challenge system
router.post("/challenges", async (req: Request, res: Response) => {
  res.json({
    challenge_id: uuidv4(),
    name: "Visit 5 times this month",
    progress: 2,
    target: 5,
    reward: 500,
    completed: false
  });
});

// Points history
router.get("/points/:guest_id", async (req: Request, res: Response) => {
  res.json({
    total_points: 15420,
    points_this_month: 1200,
    lifetime_points: 25000
  });
});

export default router;