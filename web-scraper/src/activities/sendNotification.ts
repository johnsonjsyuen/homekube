import { getProducer } from '../kafka.js';
import { scraperNotificationsSentTotal } from '../metrics.js';

export interface SendNotificationInput {
    message: string;
    subscribers: Array<{ userId: string; phone: string }>;
    workflow: string;
    jobName?: string;
}

export async function sendNotification(input: SendNotificationInput): Promise<void> {
    const producer = await getProducer();
    const failures: string[] = [];

    for (const subscriber of input.subscribers) {
        try {
            await producer.send({
                topic: 'digests',
                messages: [
                    {
                        key: subscriber.userId,
                        value: JSON.stringify({
                            userId: subscriber.userId,
                            recipientPhone: subscriber.phone,
                            message: input.message,
                            workflow: input.workflow,
                            timestamp: new Date().toISOString(),
                        }),
                    },
                ],
            });

            console.log(`[Send] Produced notification for ${subscriber.phone}`);
            if (input.jobName) {
                scraperNotificationsSentTotal.inc({ job_name: input.jobName });
            }
        } catch (err) {
            console.error(`[Send] Error producing notification for ${subscriber.phone}:`, err);
            failures.push(subscriber.phone);
        }
    }

    if (failures.length > 0) {
        throw new Error(`Failed to produce notification for ${failures.length} subscriber(s): ${failures.join(', ')}`);
    }
}
