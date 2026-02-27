import express from 'express';
import { Worker } from '@temporalio/worker';
import * as activities from './activities/index.js';
import { runMigrations } from './db.js';
import { authMiddleware } from './auth.js';
import { createRouter } from './routes.js';
import pool from './db.js';

async function main() {
    // Run database migrations
    await runMigrations();
    console.log('[Server] Migrations complete');

    // Start Express server
    const app = express();
    app.use(express.json());

    app.get('/health', (_req, res) => res.json({ status: 'ok' }));
    app.use('/api', authMiddleware, createRouter(pool));

    const port = parseInt(process.env.PORT || '3000');
    app.listen(port, () => {
        console.log(`[Server] Listening on port ${port}`);
    });

    // Start Temporal worker
    const worker = await Worker.create({
        workflowsPath: new URL('./workflow.js', import.meta.url).pathname,
        activities,
        taskQueue: 'news-digest-queue',
        connection: {
            address: process.env.TEMPORAL_ADDRESS || 'temporal-frontend:7233',
        },
    });

    console.log('[Worker] Starting news-digest worker...');
    await worker.run();
}

main().catch((err) => {
    console.error('[Worker] Fatal error:', err);
    process.exit(1);
});
