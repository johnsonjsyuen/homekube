import express from 'express';
import { createServer } from 'http';
import pool, { runMigrations } from './db.js';
import { authMiddleware } from './auth.js';
import { SessionManager } from './session-manager.js';
import { createRestRouter } from './routes/rest.js';
import { setupWebSocket } from './routes/ws.js';
import { register, httpRequestsTotal, httpRequestDurationSeconds } from './metrics.js';
import { startDigestConsumer, disconnectConsumer } from './nats-consumer.js';

const PORT = parseInt(process.env.PORT || '3000', 10);

async function main() {
    console.log('[Server] Starting WhatsApp service...');

    // Run database migrations
    await runMigrations();

    // Initialize session manager
    const sessionManager = new SessionManager(pool);

    // Restore existing sessions
    await sessionManager.restoreAllSessions();

    // Start NATS digest consumer
    if (process.env.NATS_URL) {
        startDigestConsumer(sessionManager).catch((err) => {
            console.error('[NATS] Failed to start digest consumer:', err);
        });
    }

    // Create Express app
    const app = express();
    app.use(express.json());

    // Metrics middleware — record HTTP request count and duration
    app.use((req, res, next) => {
        const start = process.hrtime.bigint();
        res.on('finish', () => {
            const durationSec = Number(process.hrtime.bigint() - start) / 1e9;
            // Normalize paths to avoid cardinality explosion
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

    // Health check (no auth)
    app.get('/health', (_req, res) => {
        res.json({ status: 'ok' });
    });

    // REST API routes (with auth)
    app.use('/api', authMiddleware, createRestRouter(pool, sessionManager));

    // Create HTTP server
    const server = createServer(app);

    // Setup WebSocket handler
    setupWebSocket(server, pool, sessionManager);

    process.on('SIGTERM', async () => {
        console.log('[Server] SIGTERM received, shutting down...');
        await disconnectConsumer();
        process.exit(0);
    });

    // Start server
    server.listen(PORT, '0.0.0.0', () => {
        console.log(`[Server] WhatsApp service listening on port ${PORT}`);
    });
}

main().catch((err) => {
    console.error('[Server] Fatal error:', err);
    process.exit(1);
});
