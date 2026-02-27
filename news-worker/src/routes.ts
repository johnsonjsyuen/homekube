import { Router } from 'express';
import type { Pool } from 'pg';
import { getCallerUserId, type TokenPayload } from './auth.js';

export function createRouter(pool: Pool): Router {
    const router = Router();

    // POST /news/subscribe
    router.post('/news/subscribe', async (req, res) => {
        try {
            const user = (req as any).user as TokenPayload;
            const userId = getCallerUserId(user);

            await pool.query(
                `INSERT INTO news_subscriptions (user_id, subscribed, subscribed_at, updated_at)
                 VALUES ($1, TRUE, NOW(), NOW())
                 ON CONFLICT (user_id)
                 DO UPDATE SET subscribed = TRUE, updated_at = NOW()`,
                [userId]
            );

            res.json({ subscribed: true });
        } catch (err: any) {
            console.error('[REST] News subscribe error:', err);
            res.status(500).json({ error: err.message });
        }
    });

    // POST /news/unsubscribe
    router.post('/news/unsubscribe', async (req, res) => {
        try {
            const user = (req as any).user as TokenPayload;
            const userId = getCallerUserId(user);

            await pool.query(
                `INSERT INTO news_subscriptions (user_id, subscribed, updated_at)
                 VALUES ($1, FALSE, NOW())
                 ON CONFLICT (user_id)
                 DO UPDATE SET subscribed = FALSE, updated_at = NOW()`,
                [userId]
            );

            res.json({ subscribed: false });
        } catch (err: any) {
            console.error('[REST] News unsubscribe error:', err);
            res.status(500).json({ error: err.message });
        }
    });

    // GET /news/subscription-status
    router.get('/news/subscription-status', async (req, res) => {
        try {
            const user = (req as any).user as TokenPayload;
            const userId = getCallerUserId(user);

            const result = await pool.query(
                'SELECT subscribed FROM news_subscriptions WHERE user_id = $1',
                [userId]
            );

            res.json({ subscribed: result.rows.length > 0 && result.rows[0].subscribed });
        } catch (err: any) {
            console.error('[REST] News subscription status error:', err);
            res.status(500).json({ error: err.message });
        }
    });

    // POST /economist/subscribe
    router.post('/economist/subscribe', async (req, res) => {
        try {
            const user = (req as any).user as TokenPayload;
            const userId = getCallerUserId(user);

            await pool.query(
                `INSERT INTO economist_subscriptions (user_id, subscribed, subscribed_at, updated_at)
                 VALUES ($1, TRUE, NOW(), NOW())
                 ON CONFLICT (user_id)
                 DO UPDATE SET subscribed = TRUE, updated_at = NOW()`,
                [userId]
            );

            res.json({ subscribed: true });
        } catch (err: any) {
            console.error('[REST] Economist subscribe error:', err);
            res.status(500).json({ error: err.message });
        }
    });

    // POST /economist/unsubscribe
    router.post('/economist/unsubscribe', async (req, res) => {
        try {
            const user = (req as any).user as TokenPayload;
            const userId = getCallerUserId(user);

            await pool.query(
                `INSERT INTO economist_subscriptions (user_id, subscribed, updated_at)
                 VALUES ($1, FALSE, NOW())
                 ON CONFLICT (user_id)
                 DO UPDATE SET subscribed = FALSE, updated_at = NOW()`,
                [userId]
            );

            res.json({ subscribed: false });
        } catch (err: any) {
            console.error('[REST] Economist unsubscribe error:', err);
            res.status(500).json({ error: err.message });
        }
    });

    // GET /economist/subscription-status
    router.get('/economist/subscription-status', async (req, res) => {
        try {
            const user = (req as any).user as TokenPayload;
            const userId = getCallerUserId(user);

            const result = await pool.query(
                'SELECT subscribed FROM economist_subscriptions WHERE user_id = $1',
                [userId]
            );

            res.json({ subscribed: result.rows.length > 0 && result.rows[0].subscribed });
        } catch (err: any) {
            console.error('[REST] Economist subscription status error:', err);
            res.status(500).json({ error: err.message });
        }
    });

    // POST /economist/trigger - manually trigger the Economist workflow
    router.post('/economist/trigger', async (req, res) => {
        try {
            const { Connection, Client } = await import('@temporalio/client');
            const connection = await Connection.connect({
                address: process.env.TEMPORAL_ADDRESS || 'temporal-frontend:7233',
            });
            const client = new Client({ connection });
            const workflowId = `economist-digest-manual-${Date.now()}`;
            const handle = await client.workflow.start('EconomistDigestWorkflow', {
                taskQueue: 'news-digest-queue',
                workflowId,
            });
            res.json({ workflowId: handle.workflowId, message: 'Economist workflow started' });
        } catch (err: any) {
            console.error('[REST] Economist trigger error:', err);
            res.status(500).json({ error: err.message });
        }
    });

    // POST /news/trigger - manually trigger the workflow for testing
    router.post('/news/trigger', async (req, res) => {
        try {
            const { Connection, Client } = await import('@temporalio/client');
            const connection = await Connection.connect({
                address: process.env.TEMPORAL_ADDRESS || 'temporal-frontend:7233',
            });
            const client = new Client({ connection });
            const workflowId = `news-digest-manual-${Date.now()}`;
            const handle = await client.workflow.start('DailyNewsDigestWorkflow', {
                taskQueue: 'news-digest-queue',
                workflowId,
            });
            res.json({ workflowId: handle.workflowId, message: 'Workflow started' });
        } catch (err: any) {
            console.error('[REST] News trigger error:', err);
            res.status(500).json({ error: err.message });
        }
    });

    return router;
}
