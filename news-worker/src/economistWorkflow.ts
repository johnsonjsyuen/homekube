import { proxyActivities, log } from '@temporalio/workflow';
import type * as activities from './activities/index.js';

const {
    fetchEconomistHeadlines,
    scrapeEconomistArticles,
    summariseEconomistWithClaude,
    getEconomistSubscribers,
    sendDigest,
    recordWorkflowComplete,
} = proxyActivities<typeof activities>({
    startToCloseTimeout: '5 minutes',
    retry: { maximumAttempts: 3 },
});

export async function EconomistDigestWorkflow(): Promise<string> {
    log.info('Starting Economist digest workflow');
    const startTime = Date.now();

    try {
        // Step 1: Fetch RSS headlines
        const headlines = await fetchEconomistHeadlines();
        log.info(`Fetched ${headlines.length} Economist headlines`);

        if (headlines.length === 0) {
            log.warn('No Economist headlines found, skipping digest');
            await recordWorkflowComplete({ workflow: 'economist', status: 'success', durationMs: Date.now() - startTime });
            return 'No headlines found';
        }

        // Step 2: Scrape article text (with RSS fallback)
        const articles = await scrapeEconomistArticles(headlines);
        log.info(`Scraped ${articles.length} Economist articles`);

        if (articles.length === 0) {
            log.warn('No Economist articles scraped successfully, skipping digest');
            await recordWorkflowComplete({ workflow: 'economist', status: 'success', durationMs: Date.now() - startTime });
            return 'No articles scraped';
        }

        // Step 3: Summarise with Claude
        const digest = await summariseEconomistWithClaude(articles);
        log.info('Generated Economist digest summary');

        // Step 4: Get subscribers
        const subscribers = await getEconomistSubscribers();
        log.info(`Found ${subscribers.length} Economist subscribers`);

        if (subscribers.length === 0) {
            log.warn('No Economist subscribers, skipping delivery');
            await recordWorkflowComplete({ workflow: 'economist', status: 'success', durationMs: Date.now() - startTime });
            return 'No subscribers';
        }

        // Step 5: Send digest
        await sendDigest({ digest, subscribers, workflow: 'economist' });
        log.info(`Economist digest sent to ${subscribers.length} subscribers`);

        await recordWorkflowComplete({ workflow: 'economist', status: 'success', durationMs: Date.now() - startTime });
        return `Economist digest sent to ${subscribers.length} subscribers`;
    } catch (err) {
        await recordWorkflowComplete({ workflow: 'economist', status: 'failure', durationMs: Date.now() - startTime });
        throw err;
    }
}
