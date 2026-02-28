import { proxyActivities, log } from '@temporalio/workflow';
import type * as activities from './activities/index.js';

const retryPolicy = { maximumAttempts: 3 };

const { loadJob, getJobSubscribers, sendNotification, recordRun } =
    proxyActivities<typeof activities>({
        startToCloseTimeout: '30 seconds',
        retry: retryPolicy,
    });

const { scrapeUrls } = proxyActivities<typeof activities>({
    startToCloseTimeout: '2 minutes',
    retry: retryPolicy,
});

const { analyseWithClaude } = proxyActivities<typeof activities>({
    startToCloseTimeout: '3 minutes',
    retry: retryPolicy,
});

export interface WebScraperInput {
    jobId: string;
}

export async function WebScraperWorkflow(input: WebScraperInput): Promise<string> {
    log.info('Starting web scraper workflow', { jobId: input.jobId });
    const startTime = Date.now();

    let job;
    try {
        // 1. Load job config from DB
        job = await loadJob(input.jobId);
        log.info(`Loaded job: ${job.name}`, { urls: job.urls.length });

        // 2. Scrape all configured URLs
        const scrapedContent = await scrapeUrls(job.urls);
        log.info(`Scraped ${scrapedContent.length}/${job.urls.length} URLs`);

        if (scrapedContent.length === 0) {
            log.warn('All URLs failed to scrape, recording failure');
            await recordRun({
                jobId: input.jobId,
                jobName: job.name,
                status: 'failure',
                urlsScraped: 0,
                notified: false,
                claudeResponse: null,
                error: 'All URLs failed to scrape',
                durationMs: Date.now() - startTime,
            });
            return 'All URLs failed to scrape';
        }

        // 3. Send to Claude with the user's instruction
        const analysis = await analyseWithClaude({
            instruction: job.instruction,
            scrapedContent,
        });
        log.info(`Claude analysis: shouldNotify=${analysis.shouldNotify}`);

        // 4. If Claude decides to notify, send via Kafka
        let notified = false;
        if (analysis.shouldNotify) {
            const subscribers = await getJobSubscribers(job.userId);
            if (subscribers.length > 0) {
                await sendNotification({
                    message: analysis.message,
                    subscribers,
                    workflow: 'web-scraper',
                    jobName: job.name,
                });
                notified = true;
                log.info(`Notification sent to ${subscribers.length} subscriber(s)`);
            } else {
                log.info('No WhatsApp sessions found for user, skipping notification');
            }
        }

        // 5. Record the run
        await recordRun({
            jobId: input.jobId,
            jobName: job.name,
            status: 'success',
            urlsScraped: scrapedContent.length,
            notified,
            claudeResponse: analysis.message,
            durationMs: Date.now() - startTime,
        });

        return analysis.shouldNotify ? 'Notification sent' : 'No notification needed';
    } catch (err) {
        try {
            await recordRun({
                jobId: input.jobId,
                jobName: job?.name ?? 'unknown',
                status: 'failure',
                urlsScraped: 0,
                notified: false,
                claudeResponse: null,
                error: String(err),
                durationMs: Date.now() - startTime,
            });
        } catch (recordErr) {
            log.error('Failed to record failure run', { recordErr: String(recordErr) });
        }
        throw err;
    }
}
