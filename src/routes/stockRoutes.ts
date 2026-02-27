import { Router } from 'express';
import {
    getAllStocks,
    getStockByTicker,
    getGainers,
    getLosers,
    getMostActive,
    getStockHistory,
    searchStocks,
    getMarketStatus,
} from '../controllers/stockController';

const router = Router();

router.get('/', getAllStocks);
router.get('/search', searchStocks);
router.get('/gainers', getGainers);
router.get('/losers', getLosers);
router.get('/active', getMostActive);
router.get('/market-status', getMarketStatus);
router.get('/history/:ticker', getStockHistory);
router.get('/:ticker', getStockByTicker);

export default router;
