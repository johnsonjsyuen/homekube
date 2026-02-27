import { Client, Connection } from '@temporalio/client';
import { ScheduleOverlapPolicy } from '@temporalio/client';

async function main() {
    const connection = await Connection.connect({
        address: process.env.TEMPORAL_ADDRESS || 'temporal-frontend:7233',
    });

    const client = new Client({ connection });

    const scheduleId = 'daily-news-digest';

    try {
        // Try to delete existing schedule first
        const handle = client.schedule.getHandle(scheduleId);
        await handle.delete();
        console.log(`[Schedule] Deleted existing schedule: ${scheduleId}`);
    } catch {
        // Schedule doesn't exist yet, that's fine
    }

    await client.schedule.create({
        scheduleId,
        spec: {
            calendars: [{ hour: [9], minute: [0] }],
            timezone: 'Australia/Sydney',
        },
        action: {
            type: 'startWorkflow',
            workflowType: 'DailyNewsDigestWorkflow',
            taskQueue: 'news-digest-queue',
        },
        policies: {
            overlap: ScheduleOverlapPolicy.SKIP,
        },
    });

    console.log(`[Schedule] Created schedule: ${scheduleId} (daily at 9:00 AM AEST/AEDT)`);
    process.exit(0);
}

main().catch((err) => {
    console.error('[Schedule] Error:', err);
    process.exit(1);
});
