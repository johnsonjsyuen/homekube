import pg from 'pg';

export interface Subscriber {
    userId: string;
    phone: string;
}

const pool = new pg.Pool({
    connectionString: process.env.WHATSAPP_DATABASE_URL,
    max: 2,
});

export async function getSubscribers(): Promise<Subscriber[]> {
    const result = await pool.query(`
        SELECT ns.user_id, s.whatsapp_jid
        FROM news_subscriptions ns
        JOIN sessions s ON ns.user_id = s.user_id
        WHERE ns.subscribed = TRUE AND s.status = 'connected'
    `);

    return result.rows
        .filter((row: any) => row.whatsapp_jid)
        .map((row: any) => {
            // Extract phone digits from JID format: 61412345678:99@s.whatsapp.net -> 61412345678
            const phone = row.whatsapp_jid.split(':')[0].split('@')[0];
            return { userId: row.user_id, phone };
        });
}
