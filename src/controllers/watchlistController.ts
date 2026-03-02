import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// ── List (Group) CRUD ──────────────────────────────────────────────

export const getLists = async (_req: Request, res: Response): Promise<void> => {
    try {
        const lists = await prisma.watchlistGroup.findMany({
            orderBy: { createdAt: 'asc' },
            include: {
                items: { orderBy: { createdAt: 'desc' } },
            },
        });

        // If no lists exist, create a default one
        if (lists.length === 0) {
            const defaultList = await prisma.watchlistGroup.create({
                data: { name: 'My Watchlist', color: '#6366f1', icon: 'star' },
                include: { items: true },
            });
            res.json({ success: true, data: [defaultList] });
            return;
        }

        res.json({ success: true, data: lists });
    } catch (error: any) {
        res.status(500).json({ success: false, error: error.message });
    }
};

export const createList = async (req: Request, res: Response): Promise<void> => {
    try {
        const { name, color, icon } = req.body;
        if (!name || !name.trim()) {
            res.status(400).json({ success: false, error: 'List name is required' });
            return;
        }

        const list = await prisma.watchlistGroup.create({
            data: {
                name: name.trim(),
                color: color || '#6366f1',
                icon: icon || 'star',
            },
            include: { items: true },
        });

        res.status(201).json({ success: true, data: list });
    } catch (error: any) {
        res.status(500).json({ success: false, error: error.message });
    }
};

export const updateList = async (req: Request, res: Response): Promise<void> => {
    try {
        const id = parseInt(req.params.id as string);
        const { name, color, icon } = req.body;

        const list = await prisma.watchlistGroup.update({
            where: { id },
            data: {
                ...(name && { name: name.trim() }),
                ...(color && { color }),
                ...(icon && { icon }),
            },
            include: { items: true },
        });

        res.json({ success: true, data: list });
    } catch (error: any) {
        if (error.code === 'P2025') {
            res.status(404).json({ success: false, error: 'List not found' });
            return;
        }
        res.status(500).json({ success: false, error: error.message });
    }
};

export const deleteList = async (req: Request, res: Response): Promise<void> => {
    try {
        const id = parseInt(req.params.id as string);
        await prisma.watchlistGroup.delete({ where: { id } });
        res.json({ success: true, message: 'List deleted' });
    } catch (error: any) {
        if (error.code === 'P2025') {
            res.status(404).json({ success: false, error: 'List not found' });
            return;
        }
        res.status(500).json({ success: false, error: error.message });
    }
};

// ── Items CRUD ─────────────────────────────────────────────────────

export const addItem = async (req: Request, res: Response): Promise<void> => {
    try {
        const groupId = parseInt(req.params.id as string);
        const { ticker, name } = req.body;

        if (!ticker) {
            res.status(400).json({ success: false, error: 'Ticker is required' });
            return;
        }

        // Check group exists
        const group = await prisma.watchlistGroup.findUnique({ where: { id: groupId } });
        if (!group) {
            res.status(404).json({ success: false, error: 'List not found' });
            return;
        }

        // Check if ticker already in this list
        const existing = await prisma.watchlistItem.findUnique({
            where: { ticker_groupId: { ticker: ticker.toUpperCase(), groupId } },
        });
        if (existing) {
            res.status(409).json({ success: false, error: 'Ticker already in this list' });
            return;
        }

        const item = await prisma.watchlistItem.create({
            data: {
                ticker: ticker.toUpperCase(),
                name: name || ticker.toUpperCase(),
                groupId,
            },
        });

        res.status(201).json({ success: true, data: item });
    } catch (error: any) {
        res.status(500).json({ success: false, error: error.message });
    }
};

export const removeItem = async (req: Request, res: Response): Promise<void> => {
    try {
        const groupId = parseInt(req.params.id as string);
        const ticker = (req.params.ticker as string).toUpperCase();

        await prisma.watchlistItem.delete({
            where: { ticker_groupId: { ticker, groupId } },
        });

        res.json({ success: true, message: `${ticker} removed from list` });
    } catch (error: any) {
        if (error.code === 'P2025') {
            res.status(404).json({ success: false, error: 'Item not found' });
            return;
        }
        res.status(500).json({ success: false, error: error.message });
    }
};

// ── Quick add (add to a list by list id, or default list) ──────────
export const quickAdd = async (req: Request, res: Response): Promise<void> => {
    try {
        const { ticker, name, groupId } = req.body;
        if (!ticker) {
            res.status(400).json({ success: false, error: 'Ticker is required' });
            return;
        }

        let targetGroupId = groupId ? parseInt(groupId) : null;

        // If no groupId provided, use the first (default) list
        if (!targetGroupId) {
            let defaultGroup = await prisma.watchlistGroup.findFirst({ orderBy: { createdAt: 'asc' } });
            if (!defaultGroup) {
                defaultGroup = await prisma.watchlistGroup.create({
                    data: { name: 'My Watchlist', color: '#6366f1', icon: 'star' },
                });
            }
            targetGroupId = defaultGroup.id;
        }

        const existing = await prisma.watchlistItem.findUnique({
            where: { ticker_groupId: { ticker: ticker.toUpperCase(), groupId: targetGroupId } },
        });
        if (existing) {
            res.status(409).json({ success: false, error: 'Already in list' });
            return;
        }

        const item = await prisma.watchlistItem.create({
            data: {
                ticker: ticker.toUpperCase(),
                name: name || ticker.toUpperCase(),
                groupId: targetGroupId,
            },
        });

        res.status(201).json({ success: true, data: item });
    } catch (error: any) {
        res.status(500).json({ success: false, error: error.message });
    }
};

// ── Check which lists contain a ticker ─────────────────────────────
export const getTickerLists = async (req: Request, res: Response): Promise<void> => {
    try {
        const ticker = (req.params.ticker as string).toUpperCase();
        const items = await prisma.watchlistItem.findMany({
            where: { ticker },
            select: { groupId: true },
        });
        res.json({ success: true, data: items.map(i => i.groupId) });
    } catch (error: any) {
        res.status(500).json({ success: false, error: error.message });
    }
};

// ── Legacy compatibility: keep old endpoints working ───────────────
export const getWatchlist = async (_req: Request, res: Response): Promise<void> => {
    try {
        const watchlist = await prisma.watchlist.findMany({
            orderBy: { createdAt: 'desc' },
        });
        res.json({ success: true, data: watchlist });
    } catch (error: any) {
        res.status(500).json({ success: false, error: error.message });
    }
};

export const addToWatchlist = async (req: Request, res: Response): Promise<void> => {
    try {
        const { ticker, name } = req.body;
        if (!ticker) {
            res.status(400).json({ success: false, error: 'Ticker is required' });
            return;
        }

        const existing = await prisma.watchlist.findUnique({
            where: { ticker: ticker.toUpperCase() },
        });

        if (existing) {
            res.status(409).json({ success: false, error: 'Ticker already in watchlist' });
            return;
        }

        const entry = await prisma.watchlist.create({
            data: {
                ticker: ticker.toUpperCase(),
                name: name || ticker.toUpperCase(),
            },
        });

        res.status(201).json({ success: true, data: entry });
    } catch (error: any) {
        res.status(500).json({ success: false, error: error.message });
    }
};

export const removeFromWatchlist = async (req: Request, res: Response): Promise<void> => {
    try {
        const ticker = (req.params.ticker as string).toUpperCase();
        await prisma.watchlist.delete({
            where: { ticker },
        });
        res.json({ success: true, message: `${ticker} removed from watchlist` });
    } catch (error: any) {
        if (error.code === 'P2025') {
            res.status(404).json({ success: false, error: 'Ticker not found in watchlist' });
            return;
        }
        res.status(500).json({ success: false, error: error.message });
    }
};
