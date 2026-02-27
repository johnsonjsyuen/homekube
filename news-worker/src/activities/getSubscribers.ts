import pool from '../db.js';
import { lookupSessions } from './whatsappClient.js';

export interface Subscriber {
    userId: string;
    phone: string;
}

export async function getSubscribers(): Promise<Subscriber[]> {
    // Get active subscriptions from workflows DB
    const subscriptions = await pool.query(
        `SELECT user_id FROM news_subscriptions WHERE subscribed = TRUE`
    );

    if (subscriptions.rows.length === 0) {
        return [];
    }

    const userIds = subscriptions.rows.map((r: any) => r.user_id);

    // Look up connected sessions via WhatsApp API
    return lookupSessions(userIds);
}
