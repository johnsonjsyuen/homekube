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

export const workflowRunsTotal = new client.Counter({
    name: 'workflow_runs_total',
    help: 'Total workflow runs',
    labelNames: ['workflow', 'status'] as const,
    registers: [register],
});

export const workflowDurationSeconds = new client.Histogram({
    name: 'workflow_duration_seconds',
    help: 'Workflow execution duration in seconds',
    labelNames: ['workflow'] as const,
    buckets: [10, 30, 60, 120, 300, 600],
    registers: [register],
});

export const workflowArticlesFetchedTotal = new client.Counter({
    name: 'workflow_articles_fetched_total',
    help: 'Total articles fetched by workflows',
    labelNames: ['workflow'] as const,
    registers: [register],
});

export const workflowMessagesSentTotal = new client.Counter({
    name: 'workflow_messages_sent_total',
    help: 'Total messages sent by workflows',
    labelNames: ['workflow'] as const,
    registers: [register],
});
