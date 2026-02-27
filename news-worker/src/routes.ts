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

    return router;
}
