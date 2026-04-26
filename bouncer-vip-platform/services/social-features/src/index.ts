import express, { Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";

const router = express.Router();

// Social types
interface Friend {
  guest_id: string;
  friend_id: string;
  status: "pending" | "accepted";
}

interface SocialPost {
  id: string;
  guest_id: string;
  content: string;
  type: "checkin" | "photo" | "event";
  likes: number;
  created_at: Date;
}

const friends: Map<string, Friend> = new Map();
const posts: Map<string, SocialPost> = new Map();

// Add friend
router.post("/friends", async (req: Request, res: Response) => {
  const friend: Friend = {
    guest_id: req.body.guest_id,
    friend_id: req.body.friend_id,
    status: "pending"
  };
  friends.set(`${friend.guest_id}_${friend.friend_id}`, friend);
  res.json(friend);
});

// Get friends
router.get("/friends/:guest_id", async (req: Request, res: Response) => {
  const list = Array.from(friends.values())
    .filter(f => f.guest_id === req.params.guest_id && f.status === "accepted");
  res.json({ friends: list });
});

// Accept friend request
router.put("/friends/accept", async (req: Request, res: Response) => {
  const key = `${req.body.guest_id}_${req.body.friend_id}`;
  const friend = friends.get(key);
  if (friend) {
    friend.status = "accepted";
    friends.set(key, friend);
    res.json(friend);
  } else {
    res.status(404).json({ error: "Friend request not found" });
  }
});

// Create post
router.post("/posts", async (req: Request, res: Response) => {
  const post: SocialPost = {
    id: uuidv4(),
    guest_id: req.body.guest_id,
    content: req.body.content,
    type: req.body.type || "checkin",
    likes: 0,
    created_at: new Date()
  };
  posts.set(post.id, post);
  res.json(post);
});

// Get feed
router.get("/feed", async (req: Request, res: Response) => {
  const feed = Array.from(posts.values())
    .sort((a, b) => b.created_at.getTime() - a.created_at.getTime())
    .slice(0, 50);
  res.json({ feed });
});

// Like post
router.post("/posts/:id/like", async (req: Request, res: Response) => {
  const post = posts.get(req.params.id);
  if (post) {
    post.likes++;
    posts.set(post.id, post);
    res.json(post);
  } else {
    res.status(404).json({ error: "Post not found" });
  }
});

export default router;