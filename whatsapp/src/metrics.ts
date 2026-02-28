import client from 'prom-client';

export const register = new client.Registry();

// Collect default Node.js metrics (GC, event loop, memory, etc.)
client.collectDefaultMetrics({ register });

// --- HTTP metrics ---

export const httpRequestsTotal = new client.Counter({
    name: 'http_requests_total',
    help: 'Total HTTP requests',
    labelNames: ['method', 'path', 'status'] as const,
    registers: [register],
});

export const httpRequestDurationSeconds = new client.Histogram({
    name: 'http_request_duration_seconds',
    help: 'HTTP request duration in seconds',
    labelNames: ['method', 'path', 'status'] as const,
    buckets: [0.01, 0.05, 0.1, 0.5, 1, 5],
    registers: [register],
});

// --- Business metrics ---

export const messagesSentTotal = new client.Counter({
    name: 'whatsapp_messages_sent_total',
    help: 'Total WhatsApp messages sent',
    registers: [register],
});

export const messagesReceivedTotal = new client.Counter({
    name: 'whatsapp_messages_received_total',
    help: 'Total WhatsApp messages received',
    registers: [register],
});

export const activeSessions = new client.Gauge({
    name: 'whatsapp_active_sessions',
    help: 'Number of active WhatsApp sessions',
    registers: [register],
});

export const sessionConnectsTotal = new client.Counter({
    name: 'whatsapp_session_connects_total',
    help: 'Total WhatsApp session connection attempts',
    labelNames: ['status'] as const,
    registers: [register],
});
