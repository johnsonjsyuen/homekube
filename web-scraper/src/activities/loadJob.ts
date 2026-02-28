import pool from '../db.js';

export interface ScrapeJob {
    id: string;
    userId: string;
    name: string;
    urls: string[];
    instruction: string;
    scheduleCron: string;
    timezone: string;
    enabled: boolean;
}

export async function loadJob(jobId: string): Promise<ScrapeJob> {
    const result = await pool.query(
        'SELECT id, user_id, name, urls, instruction, schedule_cron, timezone, enabled FROM scrape_jobs WHERE id = $1',
        [jobId]
    );

    if (result.rows.length === 0) {
        throw new Error(`Job not found: ${jobId}`);
    }

    const row = result.rows[0];
    return {
        id: row.id,
        userId: row.user_id,
        name: row.name,
        urls: row.urls,
        instruction: row.instruction,
        scheduleCron: row.schedule_cron,
        timezone: row.timezone,
        enabled: row.enabled,
    };
}
