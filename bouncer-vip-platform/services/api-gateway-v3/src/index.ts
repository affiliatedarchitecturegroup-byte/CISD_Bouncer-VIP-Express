import express, { Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";

const router = express.Router();

// Circuit breaker types
interface CircuitState {
  service: string;
  state: "closed" | "open" | "half_open";
  failures: number;
  last_failure?: Date;
}

const circuits: Map<string, CircuitState> = new Map();

// Get circuit state
router.get("/circuit/:service", async (req: Request, res: Response) => {
  const service = req.params.service;
  let state = circuits.get(service);
  
  if (!state) {
    state = { service, state: "closed", failures: 0 };
    circuits.set(service, state);
  }
  
  res.json(state);
});

// Record failure
router.post("/circuit/:service/fail", async (req: Request, res: Response) => {
  const state = circuits.get(req.params.service) || { service: req.params.service, state: "closed", failures: 0 };
  state.failures++;
  state.last_failure = new Date();
  
  if (state.failures >= 5) state.state = "open";
  
  circuits.set(req.params.service, state);
  res.json(state);
});

// Record success
router.post("/circuit/:service/success", async (req: Request, res: Response) => {
  const state = circuits.get(req.params.service);
  if (state) {
    state.state = "closed";
    state.failures = 0;
    circuits.set(req.params.service, state);
  }
  res.json(state);
});

// Advanced routing
router.post("/route", async (req: Request, res: Response) => {
  const { path, target, strategy } = req.body;
  res.json({
    route_id: uuidv4(),
    path, target, strategy,
    status: "active"
  });
});

export default router;