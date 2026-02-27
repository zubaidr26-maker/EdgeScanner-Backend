import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import stockRoutes from './routes/stockRoutes';
import scannerRoutes from './routes/scannerRoutes';
import watchlistRoutes from './routes/watchlistRoutes';
import intradayRoutes from './routes/intradayRoutes';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors({
    origin: true, // Allow all origins dynamically
    credentials: true,
}));
app.use(express.json());

// Routes
app.get('/', (_req, res) => {
    res.json({
        message: 'EdgeScanner API is running',
        endpoints: ['/api/stocks', '/api/scanner', '/api/watchlist', '/api/intraday', '/api/health']
    });
});

app.use('/api/stocks', stockRoutes);
app.use('/api/scanner', scannerRoutes);
app.use('/api/watchlist', watchlistRoutes);
app.use('/api/intraday', intradayRoutes);

// Health check
app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`🚀 Server running on http://localhost:${PORT}`);
    });
}

export default app;
