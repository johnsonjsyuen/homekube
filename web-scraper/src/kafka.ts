import { Kafka, Producer } from 'kafkajs';

const KAFKA_BROKERS = (process.env.KAFKA_BROKERS || 'tansu:9092').split(',');

const kafka = new Kafka({
    clientId: 'web-scraper',
    brokers: KAFKA_BROKERS,
});

const TOPICS = ['digests'];

let producerPromise: Promise<Producer> | null = null;

export function getProducer(): Promise<Producer> {
    if (!producerPromise) {
        producerPromise = (async () => {
            // Ensure topics exist before producing
            const admin = kafka.admin();
            await admin.connect();
            const existing = await admin.listTopics();
            const missing = TOPICS.filter((t) => !existing.includes(t));
            if (missing.length > 0) {
                await admin.createTopics({
                    topics: missing.map((topic) => ({ topic, numPartitions: 1, replicationFactor: 1 })),
                });
                console.log(`[Kafka] Created topics: ${missing.join(', ')}`);
            }
            await admin.disconnect();

            const p = kafka.producer();
            await p.connect();
            console.log('[Kafka] Producer connected');
            return p;
        })();
    }
    return producerPromise;
}

export async function disconnectProducer(): Promise<void> {
    if (producerPromise) {
        const p = await producerPromise;
        await p.disconnect();
        producerPromise = null;
        console.log('[Kafka] Producer disconnected');
    }
}
