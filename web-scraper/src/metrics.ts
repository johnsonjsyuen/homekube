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

export const scraperRunsTotal = new client.Counter({
    name: 'scraper_runs_total',
    help: 'Total scrape workflow runs',
    labelNames: ['job_name', 'status'] as const,
    registers: [register],
});

export const scraperRunDurationSeconds = new client.Histogram({
    name: 'scraper_run_duration_seconds',
    help: 'Workflow execution duration in seconds',
    labelNames: ['job_name'] as const,
    buckets: [10, 30, 60, 120, 300, 600],
    registers: [register],
});

export const scraperUrlsScrapedTotal = new client.Counter({
    name: 'scraper_urls_scraped_total',
    help: 'URLs successfully scraped',
    labelNames: ['job_name'] as const,
    registers: [register],
});

export const scraperNotificationsSentTotal = new client.Counter({
    name: 'scraper_notifications_sent_total',
    help: 'Notifications sent to WhatsApp',
    labelNames: ['job_name'] as const,
    registers: [register],
});

export const scraperActiveJobs = new client.Gauge({
    name: 'scraper_active_jobs',
    help: 'Number of enabled scrape jobs',
    registers: [register],
});
