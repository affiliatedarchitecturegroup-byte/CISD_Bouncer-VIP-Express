import express, { Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";

const router = express.Router();

// Guest Lifetime Value calculation
interface LTVCalculation {
  guest_id: string;
  total_revenue: number;
  total_visits: number;
  avg_visit_value: number;
  predicted_ltv_12m: number;
  predicted_ltv_24m: number;
  churn_risk: number;
  lifetime_tier: string;
  calculated_at: Date;
}

// Guest LTV storage
const ltvData: Map<string, LTVCalculation> = new Map();

// Calculate LTV for a guest
router.post("/calculate", async (req: Request, res: Response) => {
  const { guest_id, total_revenue, total_visits } = req.body;
  
  const avg_visit_value = total_visits > 0 ? total_revenue / total_visits : 0;
  const predicted_ltv_12m = avg_visit_value * Math.min(total_visits * 1.2, 12);
  const predicted_ltv_24m = avg_visit_value * Math.min(total_visits * 1.5, 24);
  
  // Calculate churn risk (simplified model)
  const monthly_visits = total_visits / 12 || 0;
  const churn_risk = monthly_visits < 1 ? 0.8 : monthly_visits < 2 ? 0.5 : 0.2;
  
  // Determine tier based on LTV
  let lifetime_tier = "bronze";
  if (total_revenue > 100000) lifetime_tier = "diamond";
  else if (total_revenue > 50000) lifetime_tier = "platinum";
  else if (total_revenue > 20000) lifetime_tier = "gold";
  else if (total_revenue > 5000) lifetime_tier = "silver";
  
  const calculation: LTVCalculation = {
    guest_id,
    total_revenue,
    total_visits,
    avg_visit_value,
    predicted_ltv_12m,
    predicted_ltv_24m,
    churn_risk,
    lifetime_tier,
    calculated_at: new Date()
  };
  
  ltvData.set(guest_id, calculation);
  res.json(calculation);
});

// Get LTV for guest
router.get("/:guest_id", async (req: Request, res: Response) => {
  const ltv = ltvData.get(req.params.guest_id);
  if (!ltv) {
    return res.status(404).json({ error: "LTV not found" });
  }
  res.json(ltv);
});

// Batch calculate LTV for all guests
router.post("/calculate-batch", async (req: Request, res: Response) => {
  const guest_ids = req.body.guest_ids;
  const results = [];
  
  for (const guest_id of guest_ids) {
    const total_revenue = req.body.revenue_by_guest?.[guest_id] || 0;
    const total_visits = req.body.visits_by_guest?.[guest_id] || 0;
    const avg_visit_value = total_visits > 0 ? total_revenue / total_visits : 0;
    const predicted_ltv_12m = avg_visit_value * 12;
    const predicted_ltv_24m = avg_visit_value * 24;
    
    const monthly_visits = total_visits / 12 || 0;
    const churn_risk = monthly_visits < 1 ? 0.8 : monthly_visits < 2 ? 0.5 : 0.2;
    
    let lifetime_tier = "bronze";
    if (total_revenue > 100000) lifetime_tier = "diamond";
    else if (total_revenue > 50000) lifetime_tier = "platinum";
    else if (total_revenue > 20000) lifetime_tier = "gold";
    else if (total_revenue > 5000) lifetime_tier = "silver";
    
    const calculation: LTVCalculation = {
      guest_id,
      total_revenue,
      total_visits,
      avg_visit_value,
      predicted_ltv_12m,
      predicted_ltv_24m,
      churn_risk,
      lifetime_tier,
      calculated_at: new Date()
    };
    
    ltvData.set(guest_id, calculation);
    results.push(calculation);
  }
  
  res.json({ calculated: results.length, calculations: results });
});

// Get LTV distribution
router.get("/analytics/distribution", async (req: Request, res: Response) => {
  const data = Array.from(ltvData.values());
  
  const distribution = {
    total_guests: data.length,
    by_tier: {
      diamond: data.filter(d => d.lifetime_tier === "diamond").length,
      platinum: data.filter(d => d.lifetime_tier === "platinum").length,
      gold: data.filter(d => d.lifetime_tier === "gold").length,
      silver: data.filter(d => d.lifetime_tier === "silver").length,
      bronze: data.filter(d => d.lifetime_tier === "bronze").length
    },
    at_risk: data.filter(d => d.churn_risk > 0.5).length,
    avg_ltv_12m: data.reduce((s, d) => s + d.predicted_ltv_12m, 0) / data.length || 0,
    avg_ltv_24m: data.reduce((s, d) => s + d.predicted_ltv_24m, 0) / data.length || 0,
    total_predicted_revenue_12m: data.reduce((s, d) => s + d.predicted_ltv_12m, 0),
    total_predicted_revenue_24m: data.reduce((s, d) => s + d.predicted_ltv_24m, 0)
  };
  
  res.json(distribution);
});

export default router;