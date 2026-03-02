import { Router } from 'express';
import {
    getLists, createList, updateList, deleteList,
    addItem, removeItem, quickAdd, getTickerLists,
    getWatchlist, addToWatchlist, removeFromWatchlist,
} from '../controllers/watchlistController';

const router = Router();

// ── Multi-list endpoints ───────────────────────────────────
router.get('/lists', getLists);
router.post('/lists', createList);
router.put('/lists/:id', updateList);
router.delete('/lists/:id', deleteList);

// Items within a list
router.post('/lists/:id/items', addItem);
router.delete('/lists/:id/items/:ticker', removeItem);

// Quick add (no need to know the list id from the frontend)
router.post('/quick-add', quickAdd);

// Check which lists have a ticker
router.get('/ticker/:ticker', getTickerLists);

// ── Legacy (backward compat) ───────────────────────────────
router.get('/', getWatchlist);
router.post('/', addToWatchlist);
router.delete('/:ticker', removeFromWatchlist);

export default router;
