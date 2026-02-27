import pg from 'pg';
import pool from '../db.js';

export interface Subscriber {
    userId: string;
    phone: string;
}

const whatsappPool = new pg.Pool({
    connectionString: process.env.WHATSAPP_DATABASE_URL,
    max: 2,
});

export async function getEconomistSubscribers(): Promise<Subscriber[]> {
    const subscriptions = await pool.query(
        `SELECT user_id FROM economist_subscriptions WHERE subscribed = TRUE`
    );

    if (subscriptions.rows.length === 0) {
        return [];
    }

    const userIds = subscriptions.rows.map((r: any) => r.user_id);

    const sessions = await whatsappPool.query(
        `SELECT user_id, whatsapp_jid FROM sessions
         WHERE user_id = ANY($1) AND status = 'connected'`,
        [userIds]
    );

    return sessions.rows
        .filter((row: any) => row.whatsapp_jid)
        .map((row: any) => {
            const phone = row.whatsapp_jid.split(':')[0].split('@')[0];
            return { userId: row.user_id, phone };
        });
}
