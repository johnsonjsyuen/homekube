import pg from 'pg';
import { env } from '$env/dynamic/private';

const pool = new pg.Pool({
    connectionString: env.DATABASE_URL
});

export const query = (text: string, params?: any[]) => pool.query(text, params);
