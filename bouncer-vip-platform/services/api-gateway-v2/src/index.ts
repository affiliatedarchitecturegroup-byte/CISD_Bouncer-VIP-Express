import express, { Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";

const router = express.Router();

// API Gateway v2 types
interface RouteConfig {
  path: string;
  target: string;
  methods: string[];
  rate_limit: number;
  auth_required: boolean;
}

const routes: RouteConfig[] = [
  { path: "/guests", target: "guest-service:3001", methods: ["GET", "POST"], rate_limit: 100, auth_required: true },
  { path: "/vip", target: "vip-service:3002", methods: ["GET", "POST"], rate_limit: 50, auth_required: true },
  { path: "/access", target: "access-service:3003", methods: ["POST"], rate_limit: 200, auth_required: false },
  { path: "/tables", target: "table-service:3004", methods: ["GET", "POST"], rate_limit: 100, auth_required: true },
  { path: "/events", target: "event-service:3005", methods: ["GET", "POST"], rate_limit: 50, auth_required: false },
];

// Get routes
router.get("/routes", async (req: Request, res: Response) => {
  res.json({ routes });
});

// Add route
router.post("/routes", async (req: Request, res: Response) => {
  const config: RouteConfig = {
    path: req.body.path,
    target: req.body.target,
    methods: req.body.methods || ["GET"],
    rate_limit: req.body.rate_limit || 100,
    auth_required: req.body.auth_required || false
  };
  routes.push(config);
  res.status(201).json(config);
});

// Rate limit check
router.post("/ratelimit/check", async (req: Request, res: Response) => {
  const { client_id, endpoint } = req.body;
  // Simplified rate limiting
  res.json({ allowed: true, remaining: 99, reset: 60 });
});

export default router;