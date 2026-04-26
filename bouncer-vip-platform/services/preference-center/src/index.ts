import express, { Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";

const router = express.Router();

// Preference center types
interface PreferenceSettings {
  guest_id: string;
  communication: {
    email: boolean;
    sms: boolean;
    push: boolean;
    phone: boolean;
  };
  marketing: {
    email: boolean;
    sms: boolean;
  };
  privacy: {
    show_profile: boolean;
    show_online: boolean;
    location_sharing: boolean;
  };
  data: {
    behavioral_tracking: boolean;
    analytics: boolean;
  };
}

// Get preferences
router.get("/:guest_id", async (req: Request, res: Response) => {
  res.json({
    guest_id: req.params.guest_id,
    communication: { email: true, sms: true, push: true, phone: false },
    marketing: { email: true, sms: false },
    privacy: { show_profile: true, show_online: false, location_sharing: false },
    data: { behavioral_tracking: true, analytics: true }
  });
});

// Update preferences
router.put("/:guest_id", async (req: Request, res: Response) => {
  res.json({
    guest_id: req.params.guest_id,
    ...req.body,
    updated_at: new Date().toISOString()
  });
});

// Export data
router.get("/:guest_id/export", async (req: Request, res: Response) => {
  res.json({
    guest_id: req.params.guest_id,
    export_url: `https://api.bouncervip.co.za/exports/data_${req.params.guest_id}.json`,
    expires: new Date(Date.now() + 86400000)
  });
});

// Delete account request
router.delete("/:guest_id", async (req: Request, res: Response) => {
  res.json({
    guest_id: req.params.guest_id,
    deletion_scheduled: true,
    scheduled_date: new Date(Date.now() + 30 * 86400000).toISOString()
  });
});

export default router;