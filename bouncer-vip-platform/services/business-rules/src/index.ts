// ===========================================
// Business Rules Validator Service
// Phase 1.6 - Conditional validation
// ===========================================

import express, { Request, Response } from 'express';

const app = express();
app.use(express.json());

// ===========================================
// Business Rule Types
// ===========================================

export interface BusinessRule {
  id: string;
  name: string;
  description: string;
  entity: string;
  conditions: RuleCondition[];
  actions: RuleAction[];
  priority: number;
  active: boolean;
}

interface RuleCondition {
  field: string;
  operator: 'eq' | 'ne' | 'gt' | 'lt' | 'gte' | 'lte' | 'in' | 'contains';
  value: any;
}

interface RuleAction {
  type: 'error' | 'warning' | 'require' | 'set';
  field?: string;
  value?: any;
  message?: string;
}

// ===========================================
// Rule Engine
// ===========================================

export class RuleEngine {
  private rules: Map<string, BusinessRule[]> = new Map();

  registerRule(rule: BusinessRule): void {
    const entityRules = this.rules.get(rule.entity) || [];
    entityRules.push(rule);
    entityRules.sort((a, b) => b.priority - a.priority);
    this.rules.set(rule.entity, entityRules);
  }

  evaluate(entity: string, data: any): { valid: boolean; errors: any[]; warnings: any[] } {
    const errors: any[] = [];
    const warnings: any[] = [];
    const entityRules = this.rules.get(entity) || [];

    for (const rule of entityRules) {
      if (!rule.active) continue;

      // Check all conditions
      const conditionsMet = rule.conditions.every(c => this.checkCondition(data, c));

      if (conditionsMet) {
        for (const action of rule.actions) {
          if (action.type === 'error') {
            errors.push({ rule: rule.name, message: action.message });
          } else if (action.type === 'warning') {
            warnings.push({ rule: rule.name, message: action.message });
          }
        }
      }
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  private checkCondition(data: any, condition: RuleCondition): boolean {
    const value = data[condition.field];
    const target = condition.value;

    switch (condition.operator) {
      case 'eq': return value === target;
      case 'ne': return value !== target;
      case 'gt': return value > target;
      case 'lt': return value < target;
      case 'gte': return value >= target;
      case 'lte': return value <= target;
      case 'in': return target.includes(value);
      case 'contains': return String(value).includes(String(target));
      default: return true;
    }
  }
}

// Predefined Business Rules

const ruleEngine = new RuleEngine();

// Booking conflict
ruleEngine.registerRule({
  id: 'booking_conflict',
  name: 'No booking conflicts',
  description: 'Ensure no overlapping bookings at venue',
  entity: 'booking',
  conditions: [
    { field: 'venue_id', operator: 'eq', value: null },
  ],
  actions: [
    { type: 'error', message: 'Venue already booked for this time' },
  ],
  priority: 1,
});

// Officer availability
ruleEngine.registerRule({
  id: 'officer_availability',
  name: 'Officer must be available',
  entity: 'shift',
  conditions: [
    { field: 'officer_status', operator: 'ne', value: 'active' },
  ],
  actions: [
    { type: 'error', message: 'Officer is not available' },
  ],
  priority: 1,
});

// Invoice minimum
ruleEngine.registerRule({
  id: 'invoice_minimum',
  name: 'Minimum invoice amount',
  entity: 'invoice',
  conditions: [
    { field: 'total_amount', operator: 'lt', value: 100 },
  ],
  actions: [
    { type: 'warning', message: 'Amount below minimum' },
  ],
  priority: 1,
});

// VIP requirements
ruleEngine.registerRule({
  id: 'vip_requirements',
  name: 'VIP booking must have specific requirements',
  entity: 'booking',
  conditions: [
    { field: 'vip', operator: 'eq', value: true },
  ],
  actions: [
    { type: 'require', field: 'special_instructions' },
    { type: 'require', field: 'officer_count' },
  ],
  priority: 2,
});

// ===========================================
// Custom Rule Definition
// ===========================================

export function createRule(data: Omit<BusinessRule, 'id'>): BusinessRule {
  return { id: `rule_${Date.now()}`, ...data };
}

// ===========================================
// API Routes
// ===========================================

app.post('/api/rules', async (req: Request, res: Response) => {
  const rule = createRule(req.body);
  ruleEngine.registerRule(rule);
  res.json({ success: true, data: rule });
});

app.get('/api/rules/:entity', async (req: Request, res: Response) => {
  const result = ruleEngine.evaluate(req.params.entity, req.body);
  res.json({ success: true, ...result });
});

app.post('/api/rules/validate', async (req: Request, res: Response) => {
  const { entity, data } = req.body;
  const result = ruleEngine.evaluate(entity, data);
  res.json({ success: result.valid, errors: result.errors, warnings: result.warnings });
});

app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'healthy', service: 'business-rules' });
});

const PORT = process.env.PORT || 3090;
app.listen(PORT, () => console.log(`Business Rules Service on port ${PORT}`));

export default app;