import express from 'express';
import { createServer } from 'http';
import pool, { runMigrations } from './db.js';
import { authMiddleware } from './auth.js';
import { SessionManager } from './session-manager.js';
import { createRestRouter } from './routes/rest.js';
import { setupWebSocket } from './routes/ws.js';

const PORT = parseInt(process.env.PORT || '3000', 10);

async function main() {
    console.log('[Server] Starting WhatsApp service...');

    // Run database migrations
    await runMigrations();

    // Initialize session manager
    const sessionManager = new SessionManager(pool);

    // Restore existing sessions
    await sessionManager.restoreAllSessions();

    // Create Express app
    const app = express();
    app.use(express.json());

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

    // Start server
    server.listen(PORT, '0.0.0.0', () => {
        console.log(`[Server] WhatsApp service listening on port ${PORT}`);
    });
}

main().catch((err) => {
    console.error('[Server] Fatal error:', err);
    process.exit(1);
});
