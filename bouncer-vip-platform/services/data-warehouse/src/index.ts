import express, { Request, Response } from "express";

const router = express.Router();

// Data warehouse
router.get("/datasets", async (req: Request, res: Response) => {
  res.json({
    datasets: [
      { id: "d1", name: "guests", rows: 12450 },
      { id: "d2", name: "transactions", rows: 450000 }
    ]
  });
});

router.get("/query", async (req: Request, res: Response) => {
  res.json({ results: [], rows: 0 });
});

export default router;