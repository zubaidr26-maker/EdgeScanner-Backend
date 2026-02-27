import { Router } from 'express';
import { scanStocks } from '../controllers/scannerController';

const router = Router();

router.get('/', scanStocks);

export default router;
