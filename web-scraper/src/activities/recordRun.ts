import pool from '../db.js';
import {
    scraperRunsTotal,
    scraperRunDurationSeconds,
    scraperUrlsScrapedTotal,
} from '../metrics.js';

export interface RecordRunInput {
    jobId: string;
    jobName: string;
    status: 'success' | 'failure';
    urlsScraped: number;
    notified: boolean;
    claudeResponse: string | null;
    error?: string;
    durationMs: number;
}

export async function recordRun(input: RecordRunInput): Promise<void> {
    await pool.query(
        `INSERT INTO scrape_runs (job_id, status, urls_scraped, notified, claude_response, error, completed_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
        [
            input.jobId,
            input.status,
            input.urlsScraped,
            input.notified,
            input.claudeResponse,
            input.error || null,
        ]
    );

    // Update Prometheus metrics
    scraperRunsTotal.inc({ job_name: input.jobName, status: input.status });
    scraperRunDurationSeconds.observe({ job_name: input.jobName }, input.durationMs / 1000);
    scraperUrlsScrapedTotal.inc({ job_name: input.jobName }, input.urlsScraped);
}
