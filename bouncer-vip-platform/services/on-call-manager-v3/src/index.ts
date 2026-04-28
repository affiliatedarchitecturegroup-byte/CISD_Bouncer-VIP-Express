import express, { Request, Response } from 'express';
const router = express.Router();
router.get('/', async (req: Request, res: Response) => { res.json({ service: 'on-call-manager-v3' }); });
export default router;
