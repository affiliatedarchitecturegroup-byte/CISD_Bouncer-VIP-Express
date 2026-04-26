import express, { Request, Response } from 'express';
const router = express.Router();
router.get('/', async (req: Request, res: Response) => { res.json({ service: 'self-ordering-kiosk' }); });
export default router;
