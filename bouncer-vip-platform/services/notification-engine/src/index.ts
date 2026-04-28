import express, { Request, Response } from "express";

const router = express.Router();

// Notification channels
router.get("/channels", async (req: Request, res: Response) => {
  res.json({
    channels: [
      { id: "ch1", name: "SMS", status: "active" },
      { id: "ch2", name: "Email", status: "active" },
      { id: "ch3", name: "Push", status: "active" }
    ]
  });
});

router.post("/send", async (req: Request, res: Response) => {
  res.json({ sent: true, channel: req.body.channel });
});

export default router;