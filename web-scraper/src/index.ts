import express from 'express';
import { NativeConnection, Worker } from '@temporalio/worker';
import * as activities from './activities/index.js';
import { runMigrations } from './db.js';
import { authMiddleware } from './auth.js';
import { createRouter } from './routes.js';
import pool from './db.js';
import { register, httpRequestsTotal, httpRequestDurationSeconds } from './metrics.js';
import { getProducer, disconnectProducer } from './kafka.js';

async function main() {
    // Run database migrations
    await runMigrations();
    console.log('[Server] Migrations complete');

    await getProducer();
    console.log('[Server] Kafka producer ready');

    // Start Express server
    const app = express();
    app.use(express.json());

    // Metrics middleware — record HTTP request count and duration
    app.use((req, res, next) => {
        const start = process.hrtime.bigint();
        res.on('finish', () => {
            const durationSec = Number(process.hrtime.bigint() - start) / 1e9;
            const path = req.route?.path
                ? req.baseUrl + req.route.path
                : req.path.replace(/\/[0-9a-f-]{36}/g, '/:id');
            httpRequestsTotal.inc({ method: req.method, path, status: String(res.statusCode) });
            httpRequestDurationSeconds.observe({ method: req.method, path, status: String(res.statusCode) }, durationSec);
        });
        next();
    });

    // Metrics endpoint (no auth)
    app.get('/metrics', async (_req, res) => {
        res.set('Content-Type', register.contentType);
        res.end(await register.metrics());
    });

    app.get('/health', (_req, res) => res.json({ status: 'ok' }));
    app.use('/api', authMiddleware, createRouter(pool));

    const port = parseInt(process.env.PORT || '3000');
    app.listen(port, () => {
        console.log(`[Server] Listening on port ${port}`);
    });

    // Start Temporal worker
    const connection = await NativeConnection.connect({
        address: process.env.TEMPORAL_ADDRESS || 'temporal-frontend:7233',
    });
    const worker = await Worker.create({
        workflowsPath: new URL('./workflow.js', import.meta.url).pathname,
        activities,
        taskQueue: 'web-scraper-queue',
        connection,
    });

    process.on('SIGTERM', async () => {
        console.log('[Server] SIGTERM received, shutting down...');
        await disconnectProducer();
        process.exit(0);
    });

    console.log('[Worker] Starting web-scraper worker...');
    await worker.run();
}

main().catch((err) => {
    console.error('[Worker] Fatal error:', err);
    process.exit(1);
});
