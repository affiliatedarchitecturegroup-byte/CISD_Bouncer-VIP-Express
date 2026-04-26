import express, { Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";

const router = express.Router();

// Preference types
interface Preference {
  id: string;
  guest_id: string;
  category: string;
  preference_key: string;
  preference_value: string;
  weight: number;
  created_at: Date;
}

interface PreferenceMatch {
  guest_id: string;
  recommended_items: MatchedItem[];
  score: number;
}

interface MatchedItem {
  item_id: string;
  item_type: string;
  score: number;
  reason: string;
}

// Storage
const preferences: Map<string, Preference> = new Map();

// Add/update preference
router.post("/", async (req: Request, res: Response) => {
  const pref: Preference = {
    id: uuidv4(),
    guest_id: req.body.guest_id,
    category: req.body.category,
    preference_key: req.body.preference_key,
    preference_value: req.body.preference_value,
    weight: req.body.weight || 1.0,
    created_at: new Date()
  };
  
  preferences.set(pref.id, pref);
  res.status(201).json(pref);
});

// Get guest preferences
router.get("/guest/:guest_id", async (req: Request, res: Response) => {
  const guestPrefs = Array.from(preferences.values())
    .filter(p => p.guest_id === req.params.guest_id);
  
  res.json({ preferences: guestPrefs });
});

// Find matching items
router.post("/match", async (req: Request, res: Response) => {
  const { guest_id, items } = req.body;
  const guestPrefs = Array.from(preferences.values())
    .filter(p => p.guest_id === guest_id);
  
  const matches: MatchedItem[] = [];
  
  for (const item of items) {
    let score = 0;
    let reason = "";
    
    for (const pref of guestPrefs) {
      if (item[pref.preference_key] === pref.preference_value) {
        score += pref.weight;
        reason = `Matches ${pref.category}: ${pref.preference_value}`;
      }
    }
    
    if (score > 0) {
      matches.push({
        item_id: item.id,
        item_type: item.type,
        score,
        reason
      });
    }
  }
  
  // Sort by score descending
  matches.sort((a, b) => b.score - a.score);
  
  res.json({ matches });
});

// Analytics
router.get("/analytics/overview", async (req: Request, res: Response) => {
  const prefs = Array.from(preferences.values());
  const guestIds = new Set(prefs.map(p => p.guest_id));
  
  const byCategory: Record<string, number> = {};
  for (const pref of prefs) {
    byCategory[pref.category] = (byCategory[pref.category] || 0) + 1;
  }
  
  res.json({
    total_preferences: prefs.length,
    unique_guests: guestIds.size,
    by_category: byCategory
  });
});

// Export router
export default router;