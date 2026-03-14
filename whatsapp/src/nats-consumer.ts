import { connect, NatsConnection, ConsumerMessages } from 'nats';
import type { SessionManager } from './session-manager.js';
import { phoneToJid } from './utils.js';

const NATS_URL = process.env.NATS_URL || 'nats://nats:4222';

let nc: NatsConnection | null = null;
let sub: ConsumerMessages | null = null;

export async function startDigestConsumer(sessionManager: SessionManager): Promise<void> {
    nc = await connect({ servers: NATS_URL });
    const js = nc.jetstream();
    console.log('[NATS] Connected to JetStream');

    const consumer = await js.consumers.get('DIGESTS', 'whatsapp-relay');
    sub = await consumer.consume();

    (async () => {
        for await (const msg of sub) {
            try {
                const value = new TextDecoder().decode(msg.data);
                if (!value) {
                    console.warn('[NATS] Empty message received on digests stream');
                    msg.ack();
                    continue;
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

                console.log(`[NATS] Delivering digest to ${payload.recipientPhone} (user: ${payload.userId})`);

                await sessionManager.sendMessage(payload.userId, jid, payload.message, sourceService);

                console.log(`[NATS] Delivered digest to ${payload.recipientPhone}`);
                msg.ack();
            } catch (err) {
                console.error('[NATS] Failed to deliver digest message:', err);
                msg.ack(); // Continue processing - no DLQ for homelab
            }
        }
    })();
}

export async function disconnectConsumer(): Promise<void> {
    if (sub) {
        sub.stop();
        sub = null;
    }
    if (nc) {
        await nc.drain();
        nc = null;
        console.log('[NATS] Connection closed');
    }
}
