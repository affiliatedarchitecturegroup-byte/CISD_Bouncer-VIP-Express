import express, { Request, Response, NextFunction } from "express";
import { body, validationResult, param, query } from "express-validator";
import { v4 as uuidv4 } from "uuid";

const router = express.Router();

// Types
interface GuestProfile {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  date_of_birth?: string;
  gender?: string;
  nationality?: string;
  address?: Address;
  preferences: GuestPreferences;
  tags: string[];
  status: GuestStatus;
  vip_tier: VIPTier;
  lifetime_value: number;
  total_visits: number;
  total_spent: number;
  created_at: Date;
  updated_at: Date;
}

interface Address {
  street?: string;
  city?: string;
  state?: string;
  country?: string;
  postal_code?: string;
}

interface GuestPreferences {
  drink_preferences?: string[];
  seating_preferences?: string[];
  music_preferences?: string[];
  dietary_restrictions?: string[];
  allergies?: string[];
  notification_preferences: NotificationPrefs;
}

interface NotificationPrefs {
  email: boolean;
  sms: boolean;
  push: boolean;
}

type GuestStatus = "active" | "inactive" | "banned" | "pending";
type VIPTier = "none" | "bronze" | "silver" | "gold" | "platinum" | "diamond";

// In-memory store (replace with database in production)
const guests: Map<string, GuestProfile> = new Map();

// Middleware
const validateRequest = (req: Request, res: Response, next: NextFunction) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  next();
};

// Search and filter guests
router.get("/", 
  query("page").optional().isInt({ min: 1 }),
  query("limit").optional().isInt({ min: 1, max: 100 }),
  query("status").optional().isIn(["active", "inactive", "banned", "pending"]),
  query("vip_tier").optional().isIn(["none", "bronze", "silver", "gold", "platinum", "diamond"]),
  query("search").optional().isString(),
  query("sort_by").optional().isIn(["created_at", "lifetime_value", "total_visits", "total_spent"]),
  query("sort_order").optional().isIn(["asc", "desc"]),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;
      const offset = (page - 1) * limit;
      
      let guestArray = Array.from(guests.values());
      
      // Filter by status
      if (req.query.status) {
        guestArray = guestArray.filter(g => g.status === req.query.status);
      }
      
      // Filter by VIP tier
      if (req.query.vip_tier) {
        guestArray = guestArray.filter(g => g.vip_tier === req.query.vip_tier);
      }
      
      // Search by name or email
      if (req.query.search) {
        const search = (req.query.search as string).toLowerCase();
        guestArray = guestArray.filter(g => 
          g.first_name.toLowerCase().includes(search) ||
          g.last_name.toLowerCase().includes(search) ||
          g.email.toLowerCase().includes(search)
        );
      }
      
      // Sort
      const sortBy = req.query.sort_by as keyof GuestProfile || "created_at";
      const sortOrder = req.query.sort_order === "asc" ? 1 : -1;
      guestArray.sort((a, b) => {
        const aVal = a[sortBy] ?? 0;
        const bVal = b[sortBy] ?? 0;
        if (aVal < bVal) return -1 * sortOrder;
        if (aVal > bVal) return 1 * sortOrder;
        return 0;
      });
      
      const total = guestArray.length;
      const paginatedGuests = guestArray.slice(offset, offset + limit);
      
      res.json({
        data: paginatedGuests,
        pagination: { page, limit, total, pages: Math.ceil(total / limit) }
      });
    } catch (error) {
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

// Get single guest
router.get("/:id",
  param("id").isUUID(),
  validateRequest,
  async (req: Request, res: Response) => {
    const guest = guests.get(req.params.id);
    if (!guest) {
      return res.status(404).json({ error: "Guest not found" });
    }
    res.json(guest);
  }
);

// Create new guest
router.post("/",
  body("first_name").notEmpty().trim().escape(),
  body("last_name").notEmpty().trim().escape(),
  body("email").isEmail().normalizeEmail(),
  body("phone").optional().isMobilePhone("any"),
  body("date_of_birth").optional().isISO8601(),
  body("gender").optional().isIn(["male", "female", "other"]),
  body("preferences.drink_preferences").optional().isArray(),
  body("preferences.seating_preferences").optional().isArray(),
  body("preferences.music_preferences").optional().isArray(),
  body("preferences.dietary_restrictions").optional().isArray(),
  body("preferences.allergies").optional().isArray(),
  body("tags").optional().isArray(),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const id = uuidv4();
      const now = new Date();
      
      const guest: GuestProfile = {
        id,
        first_name: req.body.first_name,
        last_name: req.body.last_name,
        email: req.body.email,
        phone: req.body.phone || "",
        date_of_birth: req.body.date_of_birth,
        gender: req.body.gender,
        address: req.body.address,
        preferences: req.body.preferences || {
          notification_preferences: { email: true, sms: true, push: true }
        },
        tags: req.body.tags || [],
        status: "active",
        vip_tier: "none",
        lifetime_value: 0,
        total_visits: 0,
        total_spent: 0,
        created_at: now,
        updated_at: now
      };
      
      guests.set(id, guest);
      
      res.status(201).json(guest);
    } catch (error) {
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

// Update guest
router.put("/:id",
  param("id").isUUID(),
  body("first_name").optional().trim().escape(),
  body("last_name").optional().trim().escape(),
  body("email").optional().isEmail().normalizeEmail(),
  body("phone").optional().isMobilePhone("any"),
  body("preferences").optional().isObject(),
  body("tags").optional().isArray(),
  validateRequest,
  async (req: Request, res: Response) => {
    const guest = guests.get(req.params.id);
    if (!guest) {
      return res.status(404).json({ error: "Guest not found" });
    }
    
    const updated = {
      ...guest,
      ...req.body,
      updated_at: new Date()
    };
    
    guests.set(req.params.id, updated);
    res.json(updated);
  }
);

// Update preferences
router.patch("/:id/preferences",
  param("id").isUUID(),
  body("drink_preferences").optional().isArray(),
  body("seating_preferences").optional().isArray(),
  body("music_preferences").optional().isArray(),
  body("dietary_restrictions").optional().isArray(),
  body("allergies").optional().isArray(),
  body("notification_preferences").optional().isObject(),
  validateRequest,
  async (req: Request, res: Response) => {
    const guest = guests.get(req.params.id);
    if (!guest) {
      return res.status(404).json({ error: "Guest not found" });
    }
    
    guest.preferences = {
      ...guest.preferences,
      ...req.body
    };
    guest.updated_at = new Date();
    guests.set(req.params.id, guest);
    
    res.json(guest);
  }
);

// Add tags
router.post("/:id/tags",
  param("id").isUUID(),
  body("tags").isArray({ min: 1 }),
  validateRequest,
  async (req: Request, res: Response) => {
    const guest = guests.get(req.params.id);
    if (!guest) {
      return res.status(404).json({ error: "Guest not found" });
    }
    
    for (const tag of req.body.tags) {
      if (!guest.tags.includes(tag)) {
        guest.tags.push(tag);
      }
    }
    guest.updated_at = new Date();
    guests.set(req.params.id, guest);
    
    res.json(guest);
  }
);

// Get guest segments
router.get("/:id/segments",
  param("id").isUUID(),
  validateRequest,
  async (req: Request, res: Response) => {
    const guest = guests.get(req.params.id);
    if (!guest) {
      return res.status(404).json({ error: "Guest not found" });
    }
    
    const segments: string[] = [];
    
    // Determine segments based on behavior
    if (guest.lifetime_value >= 100000) segments.push("whale");
    else if (guest.lifetime_value >= 50000) segments.push("dolphin");
    else if (guest.lifetime_value >= 10000) segments.push("gold_fish");
    
    if (guest.total_visits >= 100) segments.push("loyal_customer");
    else if (guest.total_visits >= 20) segments.push("regular");
    else if (guest.total_visits >= 5) segments.push("occasional");
    else segments.push("new_customer");
    
    if (guest.tags.includes("influencer")) segments.push("influencer");
    if (guest.tags.includes("celebrity")) segments.push("celebrity");
    if (guest.tags.includes("vip")) segments.push("vip_customer");
    
    res.json({ segments });
  }
);

// Delete guest
router.delete("/:id",
  param("id").isUUID(),
  validateRequest,
  async (req: Request, res: Response) => {
    if (!guests.has(req.params.id)) {
      return res.status(404).json({ error: "Guest not found" });
    }
    guests.delete(req.params.id);
    res.status(204).send();
  }
);

// Bulk operations
router.post("/bulk",
  body("operation").isIn(["activate", "deactivate", "delete", "tag"]),
  body("guest_ids").isArray({ min: 1 }),
  body("tags").optional().isArray(),
  validateRequest,
  async (req: Request, res: Response) => {
    const { operation, guest_ids, tags } = req.body;
    const results = { success: 0, failed: 0 };
    
    for (const id of guest_ids) {
      const guest = guests.get(id);
      if (!guest) {
        results.failed++;
        continue;
      }
      
      switch (operation) {
        case "activate":
          if (guest.status !== "banned") guest.status = "active";
          break;
        case "deactivate":
          guest.status = "inactive";
          break;
        case "tag":
          if (tags) {
            for (const tag of tags) {
              if (!guest.tags.includes(tag)) guest.tags.push(tag);
            }
          }
          break;
        case "delete":
          guests.delete(id);
          results.success++;
          continue;
      }
      results.success++;
    }
    
    res.json(results);
  }
);

// Analytics endpoints
router.get("/analytics/summary",
  async (req: Request, res: Response) => {
    const guestArray = Array.from(guests.values());
    
    const summary = {
      total: guestArray.length,
      by_status: {
        active: guestArray.filter(g => g.status === "active").length,
        inactive: guestArray.filter(g => g.status === "inactive").length,
        banned: guestArray.filter(g => g.status === "banned").length,
        pending: guestArray.filter(g => g.status === "pending").length
      },
      by_tier: {
        none: guestArray.filter(g => g.vip_tier === "none").length,
        bronze: guestArray.filter(g => g.vip_tier === "bronze").length,
        silver: guestArray.filter(g => g.vip_tier === "silver").length,
        gold: guestArray.filter(g => g.vip_tier === "gold").length,
        platinum: guestArray.filter(g => g.vip_tier === "platinum").length,
        diamond: guestArray.filter(g => g.vip_tier === "diamond").length
      },
      avg_lifetime_value: guestArray.reduce((sum, g) => sum + g.lifetime_value, 0) / guestArray.length || 0,
      total_revenue: guestArray.reduce((sum, g) => sum + g.total_spent, 0),
      total_visits: guestArray.reduce((sum, g) => sum + g.total_visits, 0)
    };
    
    res.json(summary);
  }
);

// Export router
export default router;