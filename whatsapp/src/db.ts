import pg from 'pg';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    max: 10,
});

export async function runMigrations(): Promise<void> {
    const migrationPath = join(__dirname, 'migrations', '001_init.sql');
    const sql = readFileSync(migrationPath, 'utf-8');
    await pool.query(sql);
    console.log('[DB] Migrations applied');
}

export default pool;
