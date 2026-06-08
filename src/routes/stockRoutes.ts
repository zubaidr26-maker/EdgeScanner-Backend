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
    getStockPeers,
    getStockNews,
    getStockFinancials,
    getStockEvents,
    getStockRealtime,
    getStockTechnicals,
} from '../controllers/stockController';

const router = Router();

router.get('/', getAllStocks);
router.get('/search', searchStocks);
router.get('/gainers', getGainers);
router.get('/losers', getLosers);
router.get('/active', getMostActive);
router.get('/market-status', getMarketStatus);
router.get('/history/:ticker', getStockHistory);
router.get('/peers/:ticker', getStockPeers);
router.get('/news/:ticker', getStockNews);
router.get('/financials/:ticker', getStockFinancials);
router.get('/events/:ticker', getStockEvents);
router.get('/realtime/:ticker', getStockRealtime);
router.get('/technicals/:ticker', getStockTechnicals);
router.get('/:ticker', getStockByTicker);

export default router;
