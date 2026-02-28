import { Kafka, Consumer } from 'kafkajs';
import type { SessionManager } from './session-manager.js';
import { phoneToJid } from './utils.js';

const KAFKA_BROKERS = (process.env.KAFKA_BROKERS || 'tansu:9092').split(',');

const kafka = new Kafka({
    clientId: 'whatsapp-relay',
    brokers: KAFKA_BROKERS,
});

let consumer: Consumer | null = null;

export async function startDigestConsumer(sessionManager: SessionManager): Promise<void> {
    consumer = kafka.consumer({ groupId: 'whatsapp-relay' });
    await consumer.connect();
    console.log('[Kafka] Digest consumer connected');

    await consumer.subscribe({ topic: 'digests', fromBeginning: false });

    await consumer.run({
        eachMessage: async ({ topic, partition, message }) => {
            try {
                const value = message.value?.toString();
                if (!value) {
                    console.warn('[Kafka] Empty message received on digests topic');
                    return;
                }

                const payload = JSON.parse(value) as {
                    userId: string;
                    recipientPhone: string;
                    message: string;
                    workflow: string;
                    timestamp: string;
                };

                const jid = phoneToJid(payload.recipientPhone);
                const sourceService = `news-worker:${payload.workflow}`;

                console.log(`[Kafka] Delivering digest to ${payload.recipientPhone} (user: ${payload.userId})`);

                await sessionManager.sendMessage(payload.userId, jid, payload.message, sourceService);

                console.log(`[Kafka] Delivered digest to ${payload.recipientPhone}`);
            } catch (err) {
                console.error('[Kafka] Failed to deliver digest message:', err);
                // Continue processing - no DLQ for homelab
            }
        },
    });
}

export async function disconnectConsumer(): Promise<void> {
    if (consumer) {
        await consumer.disconnect();
        consumer = null;
        console.log('[Kafka] Consumer disconnected');
    }
}
