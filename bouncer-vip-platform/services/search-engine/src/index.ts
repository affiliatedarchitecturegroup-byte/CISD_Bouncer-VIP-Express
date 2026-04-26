import express, { Request, Response } from "express";

const router = express.Router();

// Search types
router.get("/health", async (req: Request, res: Response) => {
  res.json({ status: "healthy", documents: 45000 });
});

// Search
router.post("/search", async (req: Request, res: Response) => {
  const { query, filters } = req.body;
  res.json({
    results: [
      { id: "g1", type: "guest", score: 0.95 },
      { id: "e1", type: "event", score: 0.82 }
    ],
    total: 2
  });
});

// Index document
router.post("/index", async (req: Request, res: Response) => {
  res.json({ indexed: true });
});

// Delete from index
router.delete("/index/:id", async (req: Request, res: Response) => {
  res.json({ deleted: true });
});

export default router;