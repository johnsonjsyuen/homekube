import { Kafka, Producer } from 'kafkajs';

const KAFKA_BROKERS = (process.env.KAFKA_BROKERS || 'tansu:9092').split(',');

const kafka = new Kafka({
    clientId: 'news-worker',
    brokers: KAFKA_BROKERS,
});

let producerPromise: Promise<Producer> | null = null;

export function getProducer(): Promise<Producer> {
    if (!producerPromise) {
        producerPromise = (async () => {
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
