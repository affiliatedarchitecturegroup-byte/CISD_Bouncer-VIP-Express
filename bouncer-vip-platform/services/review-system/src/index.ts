import express, { Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";

const router = express.Router();

// Review types
interface Review {
  id: string;
  guest_id: string;
  rating: number; // 1-5
  comment: string;
  category: string;
  status: "pending" | "approved" | "rejected";
  created_at: Date;
}

const reviews: Map<string, Review> = new Map();

// Submit review
router.post("/", async (req: Request, res: Response) => {
  const review: Review = {
    id: uuidv4(),
    guest_id: req.body.guest_id,
    rating: req.body.rating,
    comment: req.body.comment,
    category: req.body.category || "general",
    status: "pending",
    created_at: new Date()
  };
  reviews.set(review.id, review);
  res.json(review);
});

// Get reviews
router.get("/", async (req: Request, res: Response) => {
  const category = req.query.category as string;
  const status = req.query.status as string;
  
  let list = Array.from(reviews.values());
  if (category) list = list.filter(r => r.category === category);
  if (status) list = list.filter(r => r.status === status);
  else list = list.filter(r => r.status === "approved");
  
  res.json({ reviews: list });
});

// Moderate review
router.put("/:id/moderate", async (req: Request, res: Response) => {
  const review = reviews.get(req.params.id);
  if (!review) return res.status(404).json({ error: "Review not found" });
  
  review.status = req.body.status; // approve or reject
  reviews.set(review.id, review);
  res.json(review);
});

// Get rating stats
router.get("/stats", async (req: Request, res: Response) => {
  const list = Array.from(reviews.values()).filter(r => r.status === "approved");
  const avgRating = list.reduce((sum, r) => sum + r.rating, 0) / list.length || 0;
  
  res.json({
    total_reviews: list.length,
    average_rating: avgRating.toFixed(1),
    five_star: list.filter(r => r.rating === 5).length,
    four_star: list.filter(r => r.rating === 4).length,
    three_star: list.filter(r => r.rating === 3).length,
    two_star: list.filter(r => r.rating === 2).length,
    one_star: list.filter(r => r.rating === 1).length
  });
});

export default router;