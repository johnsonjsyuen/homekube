import { getProducer } from '../kafka.js';
import { workflowMessagesSentTotal } from '../metrics.js';

export interface SendDigestInput {
    digest: string;
    subscribers: Array<{ userId: string; phone: string }>;
    workflow?: string;
}

export async function sendDigest(input: SendDigestInput): Promise<void> {
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
                            message: input.digest,
                            workflow: input.workflow ?? 'unknown',
                            timestamp: new Date().toISOString(),
                        }),
                    },
                ],
            });

            console.log(`[Send] Produced digest for ${subscriber.phone}`);
            workflowMessagesSentTotal.inc({ workflow: input.workflow ?? 'unknown' });
        } catch (err) {
            console.error(`[Send] Error producing digest for ${subscriber.phone}:`, err);
            failures.push(subscriber.phone);
        }
    }

    if (failures.length > 0) {
        throw new Error(`Failed to produce digest for ${failures.length} subscriber(s): ${failures.join(', ')}`);
    }
}
