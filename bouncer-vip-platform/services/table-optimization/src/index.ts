import express, { Request, Response } from "express";

const router = express.Router();

// Table optimization
router.get("/recommendations", async (req: Request, res: Response) => {
  res.json({
    recommendations: [
      { table_id: "t1", recommendation: "upgrade", reason: "history" }
    ]
  });
});

export default router;