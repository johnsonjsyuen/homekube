import { proxyActivities, log } from '@temporalio/workflow';
import type * as activities from './activities/index.js';

const {
    fetchRssHeadlines,
    scrapeArticles,
    summariseWithClaude,
    getSubscribers,
    sendDigest,
} = proxyActivities<typeof activities>({
    startToCloseTimeout: '5 minutes',
    retry: { maximumAttempts: 3 },
});

export async function DailyNewsDigestWorkflow(): Promise<string> {
    log.info('Starting daily news digest workflow');

    // Step 1: Fetch RSS headlines
    const headlines = await fetchRssHeadlines();
    log.info(`Fetched ${headlines.length} headlines`);

    if (headlines.length === 0) {
        log.warn('No headlines found, skipping digest');
        return 'No headlines found';
    }

    // Step 2: Scrape article text
    const articles = await scrapeArticles(headlines);
    log.info(`Scraped ${articles.length} articles`);

    // Step 3: Summarise with Claude
    const digest = await summariseWithClaude(articles);
    log.info('Generated digest summary');

    // Step 4: Get subscribers
    const subscribers = await getSubscribers();
    log.info(`Found ${subscribers.length} subscribers`);

    if (subscribers.length === 0) {
        log.warn('No subscribers, skipping delivery');
        return 'No subscribers';
    }

    // Step 5: Send digest to subscribers
    await sendDigest({ digest, subscribers });
    log.info(`Digest sent to ${subscribers.length} subscribers`);

    return `Digest sent to ${subscribers.length} subscribers`;
}

export { EconomistDigestWorkflow } from './economistWorkflow.js';
