import { Router } from 'express';
import { getIntradayMovers, getIntradayChart } from '../controllers/intradayController';

const router = Router();

router.get('/', getIntradayMovers);
router.get('/chart/:ticker', getIntradayChart);

export default router;
