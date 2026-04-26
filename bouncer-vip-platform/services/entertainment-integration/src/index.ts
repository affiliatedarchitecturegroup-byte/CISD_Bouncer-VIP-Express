import express, { Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";

const router = express.Router();

// Entertainment types
interface MusicRequest {
  id: string;
  guest_id: string;
  song_title: string;
  artist: string;
  status: "pending" | "playing" | "played";
  votes: number;
}

interface DJSchedule {
  id: string;
  dj_name: string;
  date: string;
  start_time: string;
  end_time: string;
  genre: string;
}

const musicRequests: Map<string, MusicRequest> = new Map();
const djSchedules: Map<string, DJSchedule> = new Map();

// Request song
router.post("/request", async (req: Request, res: Response) => {
  const request: MusicRequest = {
    id: uuidv4(),
    guest_id: req.body.guest_id,
    song_title: req.body.song_title,
    artist: req.body.artist,
    status: "pending",
    votes: 1
  };
  musicRequests.set(request.id, request);
  res.json(request);
});

// Vote for song
router.post("/:id/vote", async (req: Request, res: Response) => {
  const request = musicRequests.get(req.params.id);
  if (!request) return res.status(404).json({ error: "Request not found" });
  
  request.votes++;
  musicRequests.set(request.id, request);
  res.json(request);
});

// Get queue
router.get("/queue", async (req: Request, res: Response) => {
  const queue = Array.from(musicRequests.values())
    .filter(r => r.status === "pending")
    .sort((a, b) => b.votes - a.votes);
  res.json({ queue });
});

// Now playing
router.get("/now-playing", async (req: Request, res: Response) => {
  const playing = Array.from(musicRequests.values())
    .find(r => r.status === "playing");
  res.json({ now_playing: playing || null });
});

// DJ Schedule
router.get("/dj/schedule", async (req: Request, res: Response) => {
  const date = req.query.date as string;
  let schedule = Array.from(djSchedules.values());
  if (date) schedule = schedule.filter(d => d.date === date);
  res.json({ schedule });
});

// Add DJ to schedule (admin)
router.post("/dj/schedule", async (req: Request, res: Response) => {
  const dj: DJSchedule = {
    id: uuidv4(),
    dj_name: req.body.dj_name,
    date: req.body.date,
    start_time: req.body.start_time,
    end_time: req.body.end_time,
    genre: req.body.genre
  };
  djSchedules.set(dj.id, dj);
  res.json(dj);
});

export default router;