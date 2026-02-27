
import { PrismaClient } from '@prisma/client';
import massiveApi from '../src/services/massiveApi';

const prisma = new PrismaClient();

async function syncTickers() {
    try {
        let cursor: string | undefined = undefined;
        let count = 0;
        let hasMore = true;

        console.log('Starting ticker sync...');

        while (hasMore) {
            const data = await massiveApi.getAllStocks(1000, cursor);
            const results = data.results || [];

            if (results.length === 0) {
                console.log('No more results.');
                break;
            }

            console.log(`Processing batch of ${results.length} tickers...`);

            // Upsert batch
            // Note: Prisma createMany with skipDuplicates is faster but upsert handles existing
            // For updates, we just overwrite name/country.
            // Using transaction for batch
            const txs = results.map((t: any) =>
                prisma.stockProfile.upsert({
                    where: { ticker: t.ticker },
                    update: {
                        name: t.name,
                        country: t.locale,
                        // If sector/industry are somehow present, map them. Usually they aren't.
                        // We preserve existing sector/industry if we don't have new ones.
                    },
                    create: {
                        ticker: t.ticker,
                        name: t.name,
                        country: t.locale,
                    },
                })
            );

            await prisma.$transaction(txs);
            count += results.length;
            console.log(`Synced ${count} tickers so far.`);

            if (data.next_url) {
                // Extract cursor from next_url if massiveApi doesn't provide it directly
                // Usually next_url looks like: /v3/reference/tickers?cursor=XYZ
                const url = new URL(data.next_url);
                cursor = url.searchParams.get('cursor') || undefined;
            } else {
                hasMore = false;
            }

            // Small delay to be polite
            await new Promise(r => setTimeout(r, 200));
        }

        console.log('Sync complete.');
    } catch (e: any) {
        console.error('Sync failed:', e.message);
    } finally {
        await prisma.$disconnect();
    }
}

syncTickers();
