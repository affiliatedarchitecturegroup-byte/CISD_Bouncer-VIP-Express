import express, { Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";

const router = express.Router();

// Document generation
router.post("/generate", async (req: Request, res: Response) => {
  res.json({
    document_id: uuidv4(),
    url: "https://cdn.bouncervip.co.za/docs/doc_" + Date.now() + ".pdf"
  });
});

router.get("/templates", async (req: Request, res: Response) => {
  res.json({
    templates: [
      { id: "t1", name: "Invoice", type: "pdf" },
      { id: "t2", name: "Receipt", type: "pdf" }
    ]
  });
});

export default router;