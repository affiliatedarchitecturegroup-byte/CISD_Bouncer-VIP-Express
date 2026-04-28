// Dashboard Security - RBAC
import express from 'express';
import { Pool } from 'pg';
const app = express();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
app.use(express.json());

// Role definitions
const roles = [
  { id: 'admin', name: 'Administrator', permissions: '*' },
  { id: 'manager', name: 'Manager', permissions: 'read,write' },
  { id: 'viewer', name: 'Viewer', permissions: 'read' },
];

// Permission check
async function hasPermission(userId: string, permission: string): Promise<boolean> {
  const result = await pool.query(`SELECT role FROM users WHERE id = $1`, [userId]);
  if (!result.rows[0]) return false;
  const role = roles.find(r => r.id === result.rows[0].role);
  return role?.permissions.includes(permission) || role?.permissions === '*';
}

// API
app.get('/api/roles', (req, res) => res.json({ success: true, data: roles }));
app.post('/api/permissions/check', async (req, res) => {
  const { user_id, permission } = req.body;
  const allowed = await hasPermission(user_id, permission);
  res.json({ success: allowed });
});
app.get('/health', (req, res) => res.json({ status: 'healthy', service: 'dashboard-security' }));

const PORT = process.env.PORT || 3303;
app.listen(PORT, () => console.log(`Dashboard Security on port ${PORT}`));

export default app;