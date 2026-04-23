// ===========================================
// Mobile UX Enhancement Service
// Phase 2.6 - UI/UX features
// ===========================================

import express, { Request, Response } from 'express';
import { Pool } from 'pg';

const app = express();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
app.use(express.json());

// ===========================================
// Skeleton Loaders
// ===========================================

interface SkeletonConfig {
  width?: string;
  height?: string;
  borderRadius?: string;
  animation?: 'pulse' | 'shimmer' | 'wave';
}

const skeletonStyles: Record<string, SkeletonConfig> = {
  card: { height: '120px', borderRadius: '8px', animation: 'shimmer' },
  avatar: { width: '48px', height: '48px', borderRadius: '50%', animation: 'pulse' },
  text: { height: '16px', borderRadius: '4px', animation: 'shimmer' },
  button: { width: '100px', height: '40px', borderRadius: '8px', animation: 'pulse' },
};

function generateSkeleton(config: SkeletonConfig): string {
  const animation = config.animation || 'shimmer';
  return `
    <div class="skeleton" style="
      width: ${config.width || '100%'};
      height: ${config.height || '20px'};
      border-radius: ${config.borderRadius || '4px'};
      background: linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%);
      background-size: 200% 100%;
      animation: ${animation} 1.5s infinite;
    "></div>
  `;
}

// ===========================================
// Pull to Refresh
// ===========================================

interface PullConfig {
  threshold?: number;
  maxDistance?: number;
  spinnerColor?: string;
}

const defaultPullConfig: PullConfig = {
  threshold: 80,
  maxDistance: 100,
  spinnerColor: '#007AFF',
};

// ===========================================
// Infinite Scroll
// ===========================================

interface ScrollConfig {
  pageSize: number;
  threshold?: number;
  prefetch?: boolean;
}

function getScrollConfig(endpoint: string): ScrollConfig {
  return {
    pageSize: 20,
    threshold: 200,
    prefetch: true,
  };
}

// ===========================================
// Haptic Feedback
// ===========================================

type HapticType = 'impact' | 'notification' | 'selection';

const hapticPatterns: Record<HapticType, any> = {
  impact: { style: 'heavy', intensity: '1.0' },
  notification: { type: 'success', delay: 0 },
  selection: { type: 'select' },
};

function getHapticConfig(type: HapticType) {
  return hapticPatterns[type];
}

// ===========================================
// Component Registry
// ===========================================

interface ComponentDef {
  id: string;
  name: string;
  props: Record<string, any>;
  code: string;
}

const componentRegistry: ComponentDef[] = [
  { id: 'skeleton', name: 'SkeletonLoader', props: {}, code: 'generateSkeleton' },
  { id: 'spinner', name: 'LoadingSpinner', props: { size: 'medium', color: 'primary' }, code: '' },
  { id: 'empty', name: 'EmptyState', props: { title: '', description: '', icon: '' }, code: '' },
  { id: 'error', name: 'ErrorState', props: { title: '', message: '', retry: true }, code: '' },
];

function getComponent(id: string): ComponentDef | null {
  return componentRegistry.find(c => c.id === id) || null;
}

// ===========================================
// User Preferences
// ===========================================

interface UXPreferences {
  user_id: string;
  theme: 'light' | 'dark' | 'system';
  font_size: 'small' | 'medium' | 'large';
  haptic_enabled: boolean;
  reduced_motion: boolean;
}

const defaultPreferences: UXPreferences = {
  user_id: '',
  theme: 'system',
  font_size: 'medium',
  haptic_enabled: true,
  reduced_motion: false,
};

async function getPreferences(userId: string): Promise<UXPreferences> {
  const result = await pool.query(`
    SELECT * FROM ux_preferences WHERE user_id = $1
  `, [userId]);
  
  if (result.rows.length === 0) {
    return { ...defaultPreferences, user_id: userId };
  }
  
  return result.rows[0];
}

async function updatePreferences(userId: string, prefs: Partial<UXPreferences>): Promise<void> {
  await pool.query(`
    INSERT INTO ux_preferences (user_id, theme, font_size, haptic_enabled, reduced_motion)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (user_id) DO UPDATE SET
      theme = COALESCE($2, theme),
      font_size = COALESCE($3, font_size),
      haptic_enabled = COALESCE($4, haptic_enabled),
      reduced_motion = COALESCE($5, reduced_motion)
  `, [userId, prefs.theme, prefs.font_size, prefs.haptic_enabled, prefs.reduced_motion]);
}

// ===========================================
// API Routes
// ===========================================

app.get('/api/skeletons/:type', (req: Request, res: Response) => {
  const skeleton = skeletonStyles[req.params.type];
  const html = generateSkeleton(skeleton || {});
  res.json({ success: true, data: { html, config: skeleton } });
});

app.get('/api/scroll/:endpoint', (req: Request, res: Response) => {
  const config = getScrollConfig(req.params.endpoint);
  res.json({ success: true, data: config });
});

app.get('/api/haptic/:type', (req: Request, res: Response) => {
  const config = getHapticConfig(req.params.type as HapticType);
  res.json({ success: true, data: config });
});

app.get('/api/components/:id', (req: Request, res: Response) => {
  const component = getComponent(req.params.id);
  if (!component) return res.status(404).json({ success: false });
  res.json({ success: true, data: component });
});

app.get('/api/components', (req: Request, res: Response) => {
  res.json({ success: true, data: componentRegistry });
});

app.get('/api/preferences/:userId', async (req: Request, res: Response) => {
  const prefs = await getPreferences(req.params.userId);
  res.json({ success: true, data: prefs });
});

app.put('/api/preferences/:userId', async (req: Request, res: Response) => {
  await updatePreferences(req.params.userId, req.body);
  res.json({ success: true });
});

app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'healthy', service: 'mobile-ux' });
});

const PORT = process.env.PORT || 3205;
app.listen(PORT, () => console.log(`Mobile UX Service on port ${PORT}`));

export default app;