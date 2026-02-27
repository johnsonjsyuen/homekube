import { Worker } from '@temporalio/worker';
import * as activities from './activities/index.js';

async function main() {
    const worker = await Worker.create({
        workflowsPath: new URL('./workflow.js', import.meta.url).pathname,
        activities,
        taskQueue: 'news-digest-queue',
        connection: {
            address: process.env.TEMPORAL_ADDRESS || 'temporal-frontend:7233',
        },
    });

    console.log('[Worker] Starting news-digest worker...');
    await worker.run();
}

main().catch((err) => {
    console.error('[Worker] Fatal error:', err);
    process.exit(1);
});
