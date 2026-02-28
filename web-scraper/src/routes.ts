import { Router } from 'express';
import type { Pool } from 'pg';
import { getCallerUserId, type TokenPayload } from './auth.js';
import { createSchedule, deleteSchedule, updateSchedule, pauseSchedule, unpauseSchedule, getTemporalClient } from './schedules/sync.js';
import { scraperActiveJobs } from './metrics.js';

const MAX_JOBS_PER_USER = 10;

// Validate cron: 5 fields, each containing only valid cron characters
function isValidCron(cron: string): boolean {
    const parts = cron.trim().split(/\s+/);
    if (parts.length !== 5) return false;
    return parts.every(p => /^[0-9*\/,\-]+$/.test(p));
}

export function createRouter(pool: Pool): Router {
    const router = Router();

    // GET /jobs — list caller's jobs
    router.get('/jobs', async (req, res) => {
        try {
            const user = (req as any).user as TokenPayload;
            const userId = getCallerUserId(user);

            const result = await pool.query(
                'SELECT * FROM scrape_jobs WHERE user_id = $1 ORDER BY created_at DESC',
                [userId]
            );

            res.json({ jobs: result.rows });
        } catch (err: any) {
            console.error('[REST] List jobs error:', err);
            res.status(500).json({ error: err.message });
        }
    });

    // POST /jobs — create a new job
    router.post('/jobs', async (req, res) => {
        try {
            const user = (req as any).user as TokenPayload;
            const userId = getCallerUserId(user);

            const { name, urls, instruction, schedule_cron, timezone } = req.body;

            // Validate required fields
            if (!name || !urls || !Array.isArray(urls) || urls.length === 0 || !instruction) {
                res.status(400).json({ error: 'name, urls (non-empty array), and instruction are required' });
                return;
            }

            // Validate cron if provided
            const cron = schedule_cron || '0 */3 * * *';
            if (!isValidCron(cron)) {
                res.status(400).json({ error: 'Invalid cron expression' });
                return;
            }

            // Check job limit
            const countResult = await pool.query(
                'SELECT COUNT(*) FROM scrape_jobs WHERE user_id = $1',
                [userId]
            );
            if (parseInt(countResult.rows[0].count) >= MAX_JOBS_PER_USER) {
                res.status(400).json({ error: `Maximum ${MAX_JOBS_PER_USER} jobs per user` });
                return;
            }

            const tz = timezone || 'Australia/Sydney';
            const result = await pool.query(
                `INSERT INTO scrape_jobs (user_id, name, urls, instruction, schedule_cron, timezone)
                 VALUES ($1, $2, $3, $4, $5, $6)
                 RETURNING *`,
                [userId, name, urls, instruction, cron, tz]
            );

            const job = result.rows[0];

            // Create Temporal schedule
            await createSchedule(job.id, cron, tz);

            // Update active jobs gauge
            const activeCount = await pool.query('SELECT COUNT(*) FROM scrape_jobs WHERE enabled = TRUE');
            scraperActiveJobs.set(parseInt(activeCount.rows[0].count));

            res.status(201).json({ job });
        } catch (err: any) {
            console.error('[REST] Create job error:', err);
            res.status(500).json({ error: err.message });
        }
    });

    // GET /jobs/:id — get a single job
    router.get('/jobs/:id', async (req, res) => {
        try {
            const user = (req as any).user as TokenPayload;
            const userId = getCallerUserId(user);

            const result = await pool.query(
                'SELECT * FROM scrape_jobs WHERE id = $1 AND user_id = $2',
                [req.params.id, userId]
            );

            if (result.rows.length === 0) {
                res.status(404).json({ error: 'Job not found' });
                return;
            }

            res.json({ job: result.rows[0] });
        } catch (err: any) {
            console.error('[REST] Get job error:', err);
            res.status(500).json({ error: err.message });
        }
    });

    // PUT /jobs/:id — update a job
    router.put('/jobs/:id', async (req, res) => {
        try {
            const user = (req as any).user as TokenPayload;
            const userId = getCallerUserId(user);

            // Check ownership
            const existing = await pool.query(
                'SELECT * FROM scrape_jobs WHERE id = $1 AND user_id = $2',
                [req.params.id, userId]
            );

            if (existing.rows.length === 0) {
                res.status(404).json({ error: 'Job not found' });
                return;
            }

            const oldJob = existing.rows[0];
            const { name, urls, instruction, schedule_cron, timezone, enabled } = req.body;

            // Validate cron if provided
            if (schedule_cron !== undefined && !isValidCron(schedule_cron)) {
                res.status(400).json({ error: 'Invalid cron expression' });
                return;
            }

            // Validate urls if provided
            if (urls !== undefined && (!Array.isArray(urls) || urls.length === 0)) {
                res.status(400).json({ error: 'urls must be a non-empty array' });
                return;
            }

            const result = await pool.query(
                `UPDATE scrape_jobs SET
                    name = COALESCE($1, name),
                    urls = COALESCE($2, urls),
                    instruction = COALESCE($3, instruction),
                    schedule_cron = COALESCE($4, schedule_cron),
                    timezone = COALESCE($5, timezone),
                    enabled = COALESCE($6, enabled),
                    updated_at = NOW()
                 WHERE id = $7 AND user_id = $8
                 RETURNING *`,
                [
                    name ?? null,
                    urls ?? null,
                    instruction ?? null,
                    schedule_cron ?? null,
                    timezone ?? null,
                    enabled ?? null,
                    req.params.id,
                    userId,
                ]
            );

            const updatedJob = result.rows[0];

            // Handle schedule changes
            const newCron = schedule_cron ?? oldJob.schedule_cron;
            const newTz = timezone ?? oldJob.timezone;
            const newEnabled = enabled ?? oldJob.enabled;

            if (schedule_cron !== undefined || timezone !== undefined) {
                // Schedule or timezone changed — recreate schedule
                await updateSchedule(updatedJob.id, newCron, newTz);
                if (!newEnabled) {
                    await pauseSchedule(updatedJob.id);
                }
            } else if (enabled !== undefined && enabled !== oldJob.enabled) {
                // Only enabled/disabled changed
                if (enabled) {
                    await unpauseSchedule(updatedJob.id);
                } else {
                    await pauseSchedule(updatedJob.id);
                }
            }

            // Update active jobs gauge
            const activeCount = await pool.query('SELECT COUNT(*) FROM scrape_jobs WHERE enabled = TRUE');
            scraperActiveJobs.set(parseInt(activeCount.rows[0].count));

            res.json({ job: updatedJob });
        } catch (err: any) {
            console.error('[REST] Update job error:', err);
            res.status(500).json({ error: err.message });
        }
    });

    // DELETE /jobs/:id — delete a job
    router.delete('/jobs/:id', async (req, res) => {
        try {
            const user = (req as any).user as TokenPayload;
            const userId = getCallerUserId(user);

            const result = await pool.query(
                'DELETE FROM scrape_jobs WHERE id = $1 AND user_id = $2 RETURNING id',
                [req.params.id, userId]
            );

            if (result.rows.length === 0) {
                res.status(404).json({ error: 'Job not found' });
                return;
            }

            // Delete Temporal schedule
            await deleteSchedule(req.params.id);

            // Update active jobs gauge
            const activeCount = await pool.query('SELECT COUNT(*) FROM scrape_jobs WHERE enabled = TRUE');
            scraperActiveJobs.set(parseInt(activeCount.rows[0].count));

            res.json({ deleted: true });
        } catch (err: any) {
            console.error('[REST] Delete job error:', err);
            res.status(500).json({ error: err.message });
        }
    });

    // POST /jobs/:id/trigger — manually trigger a job
    router.post('/jobs/:id/trigger', async (req, res) => {
        try {
            const user = (req as any).user as TokenPayload;
            const userId = getCallerUserId(user);

            // Check ownership
            const existing = await pool.query(
                'SELECT id FROM scrape_jobs WHERE id = $1 AND user_id = $2',
                [req.params.id, userId]
            );

            if (existing.rows.length === 0) {
                res.status(404).json({ error: 'Job not found' });
                return;
            }

            const client = await getTemporalClient();

            const workflowId = `web-scraper-${req.params.id}-manual-${Date.now()}`;
            const handle = await client.workflow.start('WebScraperWorkflow', {
                taskQueue: 'web-scraper-queue',
                workflowId,
                args: [{ jobId: req.params.id }],
            });

            res.json({ workflowId: handle.workflowId });
        } catch (err: any) {
            console.error('[REST] Trigger job error:', err);
            res.status(500).json({ error: err.message });
        }
    });

    // GET /jobs/:id/runs — get run history
    router.get('/jobs/:id/runs', async (req, res) => {
        try {
            const user = (req as any).user as TokenPayload;
            const userId = getCallerUserId(user);

            // Check ownership
            const existing = await pool.query(
                'SELECT id FROM scrape_jobs WHERE id = $1 AND user_id = $2',
                [req.params.id, userId]
            );

            if (existing.rows.length === 0) {
                res.status(404).json({ error: 'Job not found' });
                return;
            }

            const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
            const result = await pool.query(
                'SELECT * FROM scrape_runs WHERE job_id = $1 ORDER BY started_at DESC LIMIT $2',
                [req.params.id, limit]
            );

            res.json({ runs: result.rows });
        } catch (err: any) {
            console.error('[REST] Get runs error:', err);
            res.status(500).json({ error: err.message });
        }
    });

    return router;
}
