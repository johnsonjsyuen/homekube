# Web Scraper Service — Implementation Spec (v1)

## Context

A generalized web scraping + AI analysis workflow. Users configure URLs, a natural language instruction, and a schedule. The service scrapes the URLs, sends content to Claude Code for analysis, and Claude decides whether to notify via WhatsApp. First use case: monitoring sites for concert ticket announcements every 3 hours.

This is a new service (`web-scraper/`) following the same patterns as `news-worker/`.

---

## Architecture

```
Homepage "Scraper" Tab (UI)
  ↕ SvelteKit API proxy routes
Web Scraper Service (Express + Temporal Worker)
  → Temporal Schedule (configurable per job, cron-based)
  → Scrape URLs (fetch + HTML text extraction)
  → Claude Code pod (kubectl exec, analyze + decide notify)
  → Kafka 'digests' topic (only if Claude says notify)
  → WhatsApp service (existing consumer)
  → Prometheus /metrics
```

---

## Files to Create

### `web-scraper/` — New Service

| File | Purpose |
|------|---------|
| `package.json` | Dependencies: temporalio, express, kafkajs, pg, prom-client, jwks-rsa, jsonwebtoken |
| `tsconfig.json` | TypeScript config (same as news-worker) |
| `Dockerfile` | Multi-stage build with kubectl (same pattern as news-worker) |
| `build.sh` | Build + push to localhost:5000 |
| `src/index.ts` | Express server + Temporal worker on task queue `web-scraper-queue` |
| `src/db.ts` | Postgres pool + migration runner (reuse pattern from `news-worker/src/db.ts`) |
| `src/auth.ts` | Keycloak JWT auth middleware (reuse pattern from `news-worker/src/auth.ts`) |
| `src/kafka.ts` | Kafka producer singleton, auto-create `digests` topic (reuse from `news-worker/src/kafka.ts`) |
| `src/metrics.ts` | Prometheus registry with service-specific metrics |
| `src/routes.ts` | REST API for scrape job CRUD + manual trigger + run history |
| `src/workflow.ts` | `WebScraperWorkflow` Temporal workflow |
| `src/activities/index.ts` | Activity barrel export |
| `src/activities/scrapeUrls.ts` | Fetch + extract text from configured URLs |
| `src/activities/analyseWithClaude.ts` | Send scraped content + instruction to Claude, get structured decision |
| `src/activities/getJobSubscribers.ts` | Look up job owner's WhatsApp session via WhatsApp API |
| `src/activities/sendNotification.ts` | Produce to Kafka `digests` topic |
| `src/activities/loadJob.ts` | Load scrape job config from DB by ID |
| `src/activities/recordRun.ts` | Insert/update scrape_runs row + update Prometheus counters |
| `src/schedules/sync.ts` | Create/update/delete Temporal schedules from DB state |
| `src/migrations/001_scrape_jobs.sql` | Both tables: scrape_jobs + scrape_runs |

### `web-scraper/k8s/` — Kubernetes Manifests

| File | Purpose |
|------|---------|
| `db.yaml` | CNPG Cluster `web-scraper-db` (1 instance, `temporal` namespace) |
| `deploy.yaml` | Deployment with env vars for Temporal, Keycloak, DB, Kafka, Claude |
| `service.yaml` | ClusterIP service, port http:3000 |
| `service-monitor.yaml` | ServiceMonitor with `release: kube-prometheus-stack` label |
| `serviceaccount.yaml` | SA + Role + RoleBinding for kubectl exec into claude-code pod |

### Homepage Changes

| File | Purpose |
|------|---------|
| `homepage/src/routes/ScraperTab.svelte` | New tab: job list, create/edit forms, run history |
| `homepage/src/routes/+page.svelte` | Add "Scraper" tab button + import |
| `homepage/src/routes/api/scraper/jobs/+server.ts` | GET (list) + POST (create) proxy |
| `homepage/src/routes/api/scraper/jobs/[id]/+server.ts` | GET + PUT + DELETE proxy |
| `homepage/src/routes/api/scraper/jobs/[id]/trigger/+server.ts` | POST trigger proxy |
| `homepage/src/routes/api/scraper/jobs/[id]/runs/+server.ts` | GET run history proxy |

---

## Database Schema

### `scrape_jobs` table

```sql
CREATE TABLE scrape_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    urls TEXT[] NOT NULL,
    instruction TEXT NOT NULL,
    schedule_cron TEXT NOT NULL DEFAULT '0 */3 * * *',
    timezone TEXT NOT NULL DEFAULT 'Australia/Sydney',
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### `scrape_runs` table

```sql
CREATE TABLE scrape_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID NOT NULL REFERENCES scrape_jobs(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'running',
    urls_scraped INTEGER NOT NULL DEFAULT 0,
    notified BOOLEAN NOT NULL DEFAULT FALSE,
    claude_response TEXT,
    error TEXT,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);
```

**Implementation Implication:** Migration file `001_scrape_jobs.sql` creates both tables in a single file. The `scrape_runs` table provides both run history for the UI and data for metrics.

---

## REST API

All endpoints under `/api`, JWT-authenticated via Keycloak.

| Method | Path | Request Body | Response |
|--------|------|-------------|----------|
| `GET` | `/api/jobs` | — | `{ jobs: Job[] }` |
| `POST` | `/api/jobs` | `CreateJobBody` | `{ job: Job }` |
| `GET` | `/api/jobs/:id` | — | `{ job: Job }` |
| `PUT` | `/api/jobs/:id` | `UpdateJobBody` | `{ job: Job }` |
| `DELETE` | `/api/jobs/:id` | — | `{ deleted: true }` |
| `POST` | `/api/jobs/:id/trigger` | — | `{ workflowId: string }` |
| `GET` | `/api/jobs/:id/runs` | `?limit=20` | `{ runs: Run[] }` |

### Types

```typescript
interface CreateJobBody {
    name: string;          // e.g. "Concert Tickets"
    urls: string[];        // e.g. ["https://example.com/events"]
    instruction: string;   // e.g. "Notify me if Tool or Puscifer tickets announced"
    schedule_cron?: string; // default "0 */3 * * *"
    timezone?: string;     // default "Australia/Sydney"
}

interface UpdateJobBody {
    name?: string;
    urls?: string[];
    instruction?: string;
    schedule_cron?: string;
    timezone?: string;
    enabled?: boolean;
}

interface Job {
    id: string;
    user_id: string;
    name: string;
    urls: string[];
    instruction: string;
    schedule_cron: string;
    timezone: string;
    enabled: boolean;
    created_at: string;
    updated_at: string;
}

interface Run {
    id: string;
    job_id: string;
    status: 'running' | 'success' | 'failure';
    urls_scraped: number;
    notified: boolean;
    claude_response: string | null;
    error: string | null;
    started_at: string;
    completed_at: string | null;
}
```

**Implementation Implication:** Jobs are scoped to the authenticated user. `GET /api/jobs` returns only the caller's jobs. Update/delete verifies ownership.

---

## Temporal Workflow: `WebScraperWorkflow`

```typescript
// Input
interface WebScraperInput {
    jobId: string;
}

// Flow
export async function WebScraperWorkflow(input: WebScraperInput): Promise<string> {
    // 1. Load job config from DB
    const job = await loadJob(input.jobId);

    // 2. Scrape all configured URLs
    const scrapedContent = await scrapeUrls(job.urls);

    // 3. Send to Claude with the user's instruction
    const analysis = await analyseWithClaude({
        instruction: job.instruction,
        scrapedContent,
    });

    // 4. If Claude decides to notify, send via Kafka
    if (analysis.shouldNotify) {
        const subscribers = await getJobSubscribers(job.userId);
        if (subscribers.length > 0) {
            await sendNotification({
                message: analysis.message,
                subscribers,
                workflow: 'web-scraper',
            });
        }
    }

    // 5. Record the run
    await recordRun({
        jobId: input.jobId,
        jobName: job.name,
        status: 'success',
        urlsScraped: scrapedContent.length,
        notified: analysis.shouldNotify && /* had subscribers */,
        claudeResponse: analysis.message,
    });

    return analysis.shouldNotify ? 'Notification sent' : 'No notification needed';
}
```

**Activity timeouts:**
- `loadJob`: 30 seconds
- `scrapeUrls`: 2 minutes (multiple URLs, some may be slow)
- `analyseWithClaude`: 3 minutes (Claude can take time)
- `getJobSubscribers`: 30 seconds
- `sendNotification`: 30 seconds
- `recordRun`: 30 seconds

**Retry policy:** 3 attempts max for all activities.

---

## Claude Prompt

```
You are a web monitoring assistant. The user has configured a monitoring job with this instruction:

"{instruction}"

Below is the content scraped from the monitored URLs:

{for each url:
--- URL: {url} ---
{extracted text, truncated to 5000 chars}
}

Analyze the scraped content against the user's instruction. Respond in this exact JSON format:
{"shouldNotify": true/false, "message": "WhatsApp message if notifying, or brief status if not"}

Rules:
- Set shouldNotify to true ONLY if the content matches what the user asked to be alerted about
- If notifying, write a concise WhatsApp-friendly message using *bold* for emphasis
- If not notifying, set message to a brief status like "No matching content found"
- Do not hallucinate or invent information not present in the scraped content
```

**Implementation Implication:** The response is parsed as JSON. If Claude returns non-JSON, treat as `{ shouldNotify: false, message: "Parse error" }` and log a warning. The activity uses the same `kubectl exec` pattern as `news-worker/src/activities/summariseWithClaude.ts`.

---

## Schedule Management

Temporal schedules are managed dynamically via the Temporal Client API:

| API Action | Schedule Action |
|------------|----------------|
| `POST /api/jobs` | Create schedule `web-scraper-{jobId}` with cron spec |
| `PUT /api/jobs/:id` (schedule or enabled changed) | Delete + recreate schedule |
| `DELETE /api/jobs/:id` | Delete schedule |
| `PUT /api/jobs/:id` (enabled=false) | Pause schedule |
| `PUT /api/jobs/:id` (enabled=true) | Unpause schedule |

Schedule spec uses `spec.cronExpressions` with the job's `schedule_cron` value and `spec.timezone`.

The schedule action starts `WebScraperWorkflow` with `{ jobId }` on task queue `web-scraper-queue`.

---

## Metrics

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `http_requests_total` | Counter | method, path, status | HTTP request count |
| `http_request_duration_seconds` | Histogram | method, path, status | HTTP latency |
| `scraper_runs_total` | Counter | job_name, status | Total scrape workflow runs |
| `scraper_run_duration_seconds` | Histogram | job_name | Workflow execution time |
| `scraper_urls_scraped_total` | Counter | job_name | URLs successfully scraped |
| `scraper_notifications_sent_total` | Counter | job_name | Notifications sent to WhatsApp |
| `scraper_active_jobs` | Gauge | — | Number of enabled scrape jobs |

**Implementation Implication:** Follows same pattern as `news-worker/src/metrics.ts`. Uses `prom-client` with a custom Registry. Exposed at `GET /metrics` without auth. ServiceMonitor scrapes every 30s.

---

## Homepage UI: ScraperTab.svelte

### Layout

1. **Auth gate** — same pattern as WorkflowsTab (login required)
2. **Job list** — cards/rows showing: name, URL count, schedule, enabled toggle, last run status, "Run Now" and "Edit" buttons
3. **Create job form** — collapsible/modal:
   - Name (text input)
   - URLs (textarea, comma or newline separated)
   - Instruction (textarea)
   - Schedule (text input, default "0 */3 * * *", with human-readable preview)
   - Timezone (select, default Australia/Sydney)
4. **Run history** — expandable per job, shows last 10 runs with status badge, notification decision, timestamp

### UI patterns to follow
- Dark theme: `#2a2a2a` cards, `#222` sections, `#4a90e2` primary buttons
- Status badges: green `#4ade80` for success, red `#f87171` for failure, yellow `#f59e0b` for running
- Same spinner/loading patterns as WorkflowsTab
- Auth via `$lib/auth` (initKeycloak, getFreshToken)

---

## Anti-Patterns (DO NOT)

| Don't | Do Instead | Why |
|-------|-----------|-----|
| Store scraped content in DB | Only store Claude's response + decision | Content can be huge, DB bloat |
| Run scraping in the Express request handler | Always run via Temporal workflow | Timeouts, retries, observability |
| Hardcode the Claude prompt format | Keep prompt as a template string in the activity | May need tuning |
| Let users create unlimited jobs | Cap at 10 jobs per user | Resource protection |
| Parse Claude's JSON response without try/catch | Always wrap in try/catch, default to no-notify | Claude may return malformed JSON |
| Use `fetch` without timeout for scraping | Set 30-second timeout per URL | Hanging requests block the workflow |
| Trust user-provided cron expressions blindly | Validate cron syntax before saving | Invalid cron crashes schedule creation |
| Create a new Kafka topic | Reuse existing `digests` topic | WhatsApp consumer already listens on it |

---

## Error Handling Matrix

| Error Type | Detection | Response | Fallback | Logging |
|------------|-----------|----------|----------|---------|
| URL fetch fails (4xx/5xx) | HTTP status check | Skip URL, continue with others | Log warning, proceed | WARN |
| URL fetch timeout (>30s) | AbortController timeout | Skip URL | Log warning, proceed | WARN |
| All URLs fail to scrape | Zero content after scraping | Skip Claude, record failure | Log error | ERROR |
| Claude pod not found | kubectl returns empty | Throw, let Temporal retry | — | ERROR |
| Claude returns non-JSON | JSON.parse throws | Default to `shouldNotify: false` | Log response for debugging | WARN |
| Claude timeout (>2min) | execFile timeout | Throw, let Temporal retry | — | ERROR |
| Kafka produce fails | kafkajs error | Throw, let Temporal retry | — | ERROR |
| WhatsApp session not found | Empty subscriber list | Skip notification, still record success | Log info | INFO |
| Invalid cron in API | Validation check | Return 400 | — | WARN |
| Job not found | DB query empty | Return 404 / abort workflow | — | WARN |

---

## Test Specifications

### Unit Tests

| Test ID | Component | Input | Expected Output | Edge Cases |
|---------|-----------|-------|-----------------|------------|
| TC-001 | scrapeUrls | 3 valid URLs | 3 content items with text | Empty HTML, timeout, 404 |
| TC-002 | analyseWithClaude | Content + instruction | JSON with shouldNotify + message | Non-JSON Claude response, empty content |
| TC-003 | Routes: POST /api/jobs | Valid body | 201 + job object | Missing fields, invalid cron, too many jobs |
| TC-004 | Routes: PUT /api/jobs/:id | Partial update | Updated job | Non-owner update (403), non-existent (404) |
| TC-005 | Routes: DELETE /api/jobs/:id | Valid ID | 200 + deleted | Non-owner (403), non-existent (404) |
| TC-006 | Schedule sync | Job create | Temporal schedule created | Schedule already exists |

### Integration Tests

| Test ID | Flow | Setup | Verification | Teardown |
|---------|------|-------|--------------|----------|
| IT-001 | Full workflow | Create job in DB | Workflow runs, scrapes, analyzes, records run | Delete job |
| IT-002 | Notification path | Job + matching content | Kafka message produced | Delete job |
| IT-003 | No-notification path | Job + non-matching content | No Kafka message, run recorded as success | Delete job |

---

## References

| Topic | Location |
|-------|----------|
| News-worker workflow pattern | `news-worker/src/workflow.ts` |
| Claude exec pattern | `news-worker/src/activities/summariseWithClaude.ts` |
| Kafka producer pattern | `news-worker/src/kafka.ts` |
| Metrics pattern | `news-worker/src/metrics.ts` |
| Auth middleware pattern | `news-worker/src/auth.ts` |
| DB + migrations pattern | `news-worker/src/db.ts` |
| K8s RBAC for claude-code | `news-worker/k8s/serviceaccount.yaml` |
| K8s deployment pattern | `news-worker/k8s/deploy.yaml` |
| Homepage tab pattern | `homepage/src/routes/WorkflowsTab.svelte` |
| Homepage API proxy pattern | `homepage/src/routes/api/workflows/news/trigger/+server.ts` |
| Digest message schema | `{ userId, recipientPhone, message, workflow, timestamp }` on `digests` topic |
| WhatsApp session lookup | `POST /api/sessions/lookup` on whatsapp service |

---

## Implementation Order

1. Service scaffolding (package.json, tsconfig, Dockerfile, build.sh)
2. Core infra (db.ts, auth.ts, kafka.ts, metrics.ts)
3. Database migration (001_scrape_jobs.sql)
4. Activities (loadJob, scrapeUrls, analyseWithClaude, getJobSubscribers, sendNotification, recordRun)
5. Workflow (WebScraperWorkflow)
6. REST API (routes.ts — CRUD + trigger + runs)
7. Schedule sync (dynamic Temporal schedule management)
8. Express server + Temporal worker (index.ts)
9. Kubernetes manifests (db, deploy, service, service-monitor, serviceaccount)
10. Homepage ScraperTab.svelte
11. Homepage API proxy routes
12. Homepage +page.svelte (add tab)
