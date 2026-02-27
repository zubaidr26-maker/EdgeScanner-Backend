import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

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
        const tickerParam = req.params.ticker;
        const ticker = Array.isArray(tickerParam) ? tickerParam[0] : tickerParam;
        await prisma.watchlist.delete({
            where: { ticker: ticker.toUpperCase() },
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
