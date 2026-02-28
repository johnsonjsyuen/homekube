import { Connection, Client, ScheduleOverlapPolicy } from '@temporalio/client';

let clientPromise: Promise<Client> | null = null;

export function getTemporalClient(): Promise<Client> {
    if (!clientPromise) {
        clientPromise = (async () => {
            const connection = await Connection.connect({
                address: process.env.TEMPORAL_ADDRESS || 'temporal-frontend:7233',
            });
            return new Client({ connection });
        })();
    }
    return clientPromise;
}

function scheduleId(jobId: string): string {
    return `web-scraper-${jobId}`;
}

export async function createSchedule(jobId: string, cron: string, timezone: string): Promise<void> {
    const client = await getTemporalClient();
    const id = scheduleId(jobId);

    await client.schedule.create({
        scheduleId: id,
        spec: {
            cronExpressions: [cron],
            timezone,
        },
        action: {
            type: 'startWorkflow',
            workflowType: 'WebScraperWorkflow',
            args: [{ jobId }],
            taskQueue: 'web-scraper-queue',
            workflowId: `web-scraper-${jobId}`,
        },
        policies: {
            overlap: ScheduleOverlapPolicy.SKIP,
        },
    });

    console.log(`[Schedule] Created schedule ${id}`);
}

export async function deleteSchedule(jobId: string): Promise<void> {
    const client = await getTemporalClient();
    const id = scheduleId(jobId);

    try {
        const handle = client.schedule.getHandle(id);
        await handle.delete();
        console.log(`[Schedule] Deleted schedule ${id}`);
    } catch (err: any) {
        // Ignore if schedule doesn't exist
        if (err.message?.includes('not found') || err.code === 5) {
            console.log(`[Schedule] Schedule ${id} not found, nothing to delete`);
        } else {
            throw err;
        }
    }
}

export async function updateSchedule(jobId: string, cron: string, timezone: string): Promise<void> {
    await deleteSchedule(jobId);
    await createSchedule(jobId, cron, timezone);
}

export async function pauseSchedule(jobId: string): Promise<void> {
    const client = await getTemporalClient();
    const id = scheduleId(jobId);

    try {
        const handle = client.schedule.getHandle(id);
        await handle.pause('Job disabled by user');
        console.log(`[Schedule] Paused schedule ${id}`);
    } catch (err: any) {
        if (err.message?.includes('not found') || err.code === 5) {
            console.log(`[Schedule] Schedule ${id} not found, nothing to pause`);
        } else {
            throw err;
        }
    }
}

export async function unpauseSchedule(jobId: string): Promise<void> {
    const client = await getTemporalClient();
    const id = scheduleId(jobId);

    try {
        const handle = client.schedule.getHandle(id);
        await handle.unpause('Job enabled by user');
        console.log(`[Schedule] Unpaused schedule ${id}`);
    } catch (err: any) {
        if (err.message?.includes('not found') || err.code === 5) {
            console.log(`[Schedule] Schedule ${id} not found, nothing to unpause`);
        } else {
            throw err;
        }
    }
}
