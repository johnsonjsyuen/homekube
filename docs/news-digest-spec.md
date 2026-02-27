# Daily ABC News Digest Implementation Spec (Implementation)

## 1. Database Schema

Add a `news_subscriptions` table to the WhatsApp Postgres database via a new migration file:

```sql
-- File: whatsapp/src/migrations/002_news_subscriptions.sql

CREATE TABLE IF NOT EXISTS news_subscriptions (
    user_id       TEXT PRIMARY KEY,
    subscribed    BOOLEAN NOT NULL DEFAULT TRUE,
    subscribed_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at    TIMESTAMPTZ DEFAULT NOW()
);
```

Phone numbers are not stored in this table. At delivery time, the worker joins with `sessions.whatsapp_jid` to resolve each subscriber's phone number.

### Schema Notes

| Column | Type | Purpose |
|--------|------|---------|
| `user_id` | `TEXT PK` | Correlates with `sessions.user_id` -- identifies the subscribed user |
| `subscribed` | `BOOLEAN` | Soft opt-in/out toggle (no row deletion on unsubscribe) |
| `subscribed_at` | `TIMESTAMPTZ` | First subscription time |
| `updated_at` | `TIMESTAMPTZ` | Last toggle time |

## 2. Migration Runner Upgrade

The migration runner in `db.ts` uses a `schema_migrations` tracking table and reads all `*.sql` files sorted by name. This replaced the previous single-file approach.

```typescript
export async function runMigrations(): Promise<void> {
    const client = await pool.connect();
    try {
        // Ensure schema_migrations table exists
        await client.query(`
            CREATE TABLE IF NOT EXISTS schema_migrations (
                filename TEXT PRIMARY KEY,
                applied_at TIMESTAMPTZ DEFAULT NOW()
            )
        `);

        // Get already-applied migrations
        const applied = await client.query('SELECT filename FROM schema_migrations');
        const appliedSet = new Set(applied.rows.map(r => r.filename));

        // Read all .sql files from migrations directory, sorted
        const migrationsDir = join(__dirname, 'migrations');
        const files = readdirSync(migrationsDir)
            .filter(f => f.endsWith('.sql'))
            .sort();

        for (const file of files) {
            if (appliedSet.has(file)) {
                continue;
            }

            const sql = readFileSync(join(migrationsDir, file), 'utf-8');
            await client.query('BEGIN');
            try {
                await client.query(sql);
                await client.query(
                    'INSERT INTO schema_migrations (filename) VALUES ($1)',
                    [file]
                );
                await client.query('COMMIT');
                console.log(`[DB] Applied migration: ${file}`);
            } catch (err) {
                await client.query('ROLLBACK');
                throw err;
            }
        }

        console.log('[DB] Migrations up to date');
    } finally {
        client.release();
    }
}
```

### Behavior Matrix

| Scenario | Result |
|----------|--------|
| Fresh DB, no `schema_migrations` table | Creates tracking table, runs all `*.sql` files in order |
| Existing DB with `001_init.sql` already applied | Skips `001_init.sql`, runs `002_news_subscriptions.sql` onward |
| All migrations already applied | Logs "up to date", no-op |
| Migration fails mid-execution | Rolls back that single migration, throws error |

## 3. WhatsApp Subscription Routes

Three new endpoints added to `routes/rest.ts` using the existing `getCallerUserId()` pattern for ownership enforcement:

### `POST /api/news/subscribe`

```typescript
router.post('/news/subscribe', async (req, res) => {
    try {
        const user = (req as any).user as TokenPayload;
        const userId = getCallerUserId(user);

        await pool.query(
            `INSERT INTO news_subscriptions (user_id, subscribed, subscribed_at, updated_at)
             VALUES ($1, TRUE, NOW(), NOW())
             ON CONFLICT (user_id)
             DO UPDATE SET subscribed = TRUE, updated_at = NOW()`,
            [userId]
        );

        res.json({ subscribed: true });
    } catch (err: any) {
        console.error('[REST] News subscribe error:', err);
        res.status(500).json({ error: err.message });
    }
});
```

### `POST /api/news/unsubscribe`

```typescript
router.post('/news/unsubscribe', async (req, res) => {
    try {
        const user = (req as any).user as TokenPayload;
        const userId = getCallerUserId(user);

        await pool.query(
            `INSERT INTO news_subscriptions (user_id, subscribed, updated_at)
             VALUES ($1, FALSE, NOW())
             ON CONFLICT (user_id)
             DO UPDATE SET subscribed = FALSE, updated_at = NOW()`,
            [userId]
        );

        res.json({ subscribed: false });
    } catch (err: any) {
        console.error('[REST] News unsubscribe error:', err);
        res.status(500).json({ error: err.message });
    }
});
```

### `GET /api/news/subscription-status`

```typescript
router.get('/news/subscription-status', async (req, res) => {
    try {
        const user = (req as any).user as TokenPayload;
        const userId = getCallerUserId(user);

        const result = await pool.query(
            'SELECT subscribed FROM news_subscriptions WHERE user_id = $1',
            [userId]
        );

        res.json({ subscribed: result.rows.length > 0 && result.rows[0].subscribed });
    } catch (err: any) {
        console.error('[REST] News subscription status error:', err);
        res.status(500).json({ error: err.message });
    }
});
```

### Route Behavior Summary

| Endpoint | Auth | Method | Success Response | Error Response |
|----------|------|--------|-----------------|----------------|
| `/api/news/subscribe` | Bearer JWT | POST | `{ "subscribed": true }` | `500 { "error": "..." }` |
| `/api/news/unsubscribe` | Bearer JWT | POST | `{ "subscribed": false }` | `500 { "error": "..." }` |
| `/api/news/subscription-status` | Bearer JWT | GET | `{ "subscribed": true/false }` | `500 { "error": "..." }` |

All three endpoints use `getCallerUserId(user)` -- no `userId` body parameter, so no cross-user authz needed (same pattern as `/api/link`, `/api/status`, etc.).

## 4. Homepage Proxy Routes

Three SvelteKit server routes under `homepage/src/routes/api/whatsapp/news/` that proxy to the WhatsApp service, passing the Keycloak Bearer token through:

### `src/routes/api/whatsapp/news/subscribe/+server.ts`

```typescript
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
    const authHeader = request.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return json({ error: 'Unauthorized: Missing or invalid token' }, { status: 401 });
    }

    try {
        const response = await fetch('http://whatsapp/api/news/subscribe', {
            method: 'POST',
            headers: { 'Authorization': authHeader }
        });

        const data = await response.json();
        return json(data, { status: response.status });
    } catch (e) {
        console.error('Error proxying to WhatsApp news subscribe:', e);
        return json({ error: 'Internal Server Error' }, { status: 500 });
    }
};
```

### `src/routes/api/whatsapp/news/unsubscribe/+server.ts`

```typescript
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
    const authHeader = request.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return json({ error: 'Unauthorized: Missing or invalid token' }, { status: 401 });
    }

    try {
        const response = await fetch('http://whatsapp/api/news/unsubscribe', {
            method: 'POST',
            headers: { 'Authorization': authHeader }
        });

        const data = await response.json();
        return json(data, { status: response.status });
    } catch (e) {
        console.error('Error proxying to WhatsApp news unsubscribe:', e);
        return json({ error: 'Internal Server Error' }, { status: 500 });
    }
};
```

### `src/routes/api/whatsapp/news/status/+server.ts`

```typescript
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ request }) => {
    const authHeader = request.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return json({ error: 'Unauthorized: Missing or invalid token' }, { status: 401 });
    }

    try {
        const response = await fetch('http://whatsapp/api/news/subscription-status', {
            headers: { 'Authorization': authHeader }
        });

        const data = await response.json();
        return json(data, { status: response.status });
    } catch (e) {
        console.error('Error proxying to WhatsApp news status:', e);
        return json({ error: 'Internal Server Error' }, { status: 500 });
    }
};
```

## 5. Homepage UI Changes

A new "Daily News Digest" section added to `WhatsAppTab.svelte`, displayed when the WhatsApp session is connected. Placed between the Account Status section and the Send Message section.

### State Variables

```typescript
let newsSubscribed = $state(false);
let newsLoading = $state(false);
let newsError = $state('');
```

### Functions

```typescript
async function fetchSubscriptionStatus() {
    try {
        const token = await getFreshToken();
        if (!token) return;
        const res = await fetch('/api/whatsapp/news/status', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        newsSubscribed = data.subscribed || false;
    } catch (err: any) {
        console.error('[WhatsApp] News status fetch error:', err);
    }
}

async function toggleNewsSubscription() {
    newsLoading = true;
    newsError = '';
    try {
        const token = await getFreshToken();
        if (!token) return;
        const endpoint = newsSubscribed ? '/api/whatsapp/news/unsubscribe' : '/api/whatsapp/news/subscribe';
        const res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        if (!res.ok) {
            newsError = data.error || 'Failed to update subscription';
            return;
        }
        newsSubscribed = data.subscribed;
    } catch (err: any) {
        newsError = err.message;
    } finally {
        newsLoading = false;
    }
}
```

### UI Section

```svelte
{#if sessionStatus === 'connected'}
    <div class="section">
        <h4>Daily News Digest</h4>
        <p class="section-description">Get a daily AI-summarised digest of top ABC News headlines delivered to your WhatsApp at 9 AM AEST.</p>
        <div class="digest-status">
            Status: <span class="status-badge" class:status-connected={newsSubscribed} class:status-disconnected={!newsSubscribed}>
                {newsSubscribed ? 'subscribed' : 'not subscribed'}
            </span>
        </div>
        {#if newsSubscribed}
            <button class="unsubscribe-btn" onclick={toggleNewsSubscription} disabled={newsLoading}>
                {#if newsLoading}
                    <span class="spinner">...</span> Updating...
                {:else}
                    Unsubscribe
                {/if}
            </button>
        {:else}
            <button class="subscribe-btn" onclick={toggleNewsSubscription} disabled={newsLoading}>
                {#if newsLoading}
                    <span class="spinner">...</span> Updating...
                {:else}
                    Subscribe to Daily Digest
                {/if}
            </button>
        {/if}
        {#if newsError}
            <div class="send-result error">{newsError}</div>
        {/if}
    </div>
{/if}
```

Subscription status is fetched on mount when the user is authenticated via the `$effect` block alongside session status.

## 6. Temporal Workflow (DailyNewsDigestWorkflow)

### Workflow Definition

```typescript
import { proxyActivities, log } from '@temporalio/workflow';
import type { NewsActivities } from './activities';

const {
    fetchRssHeadlines,
    scrapeArticles,
    summarizeWithClaude,
    getActiveSubscribers,
    sendWhatsAppMessage,
} = proxyActivities<NewsActivities>({
    startToCloseTimeout: '5 minutes',
    retry: { maximumAttempts: 3 },
});

export async function DailyNewsDigestWorkflow(): Promise<void> {
    // Step 1: Fetch RSS headlines from ABC News
    log.info('Fetching RSS headlines');
    const headlines = await fetchRssHeadlines();

    if (headlines.length === 0) {
        log.warn('No headlines found, skipping digest');
        return;
    }

    // Step 2: Scrape article content (top 20)
    log.info(`Scraping ${headlines.length} articles`);
    const articles = await scrapeArticles(headlines.slice(0, 20));

    // Step 3: Summarize with Claude via kubectl exec
    log.info('Generating AI summary');
    const digest = await summarizeWithClaude(articles);

    // Step 4: Get all active subscribers
    log.info('Fetching active subscribers');
    const subscribers = await getActiveSubscribers();

    if (subscribers.length === 0) {
        log.warn('No active subscribers, skipping delivery');
        return;
    }

    // Step 5: Deliver to each subscriber
    log.info(`Delivering digest to ${subscribers.length} subscribers`);
    for (const subscriber of subscribers) {
        try {
            await sendWhatsAppMessage(subscriber.phoneNumber, digest);
        } catch (err) {
            log.error(`Failed to deliver to ${subscriber.phoneNumber}`, { error: String(err) });
            // Continue to next subscriber -- don't fail entire workflow
        }
    }

    log.info('Daily digest delivery complete');
}
```

### Activity Signatures

```typescript
export interface Headline {
    title: string;
    link: string;
    pubDate: string;
}

export interface Article {
    title: string;
    link: string;
    content: string;
}

export interface Subscriber {
    userId: string;
    phoneNumber: string;
}

export interface NewsActivities {
    fetchRssHeadlines(): Promise<Headline[]>;
    scrapeArticles(headlines: Headline[]): Promise<Article[]>;
    summarizeWithClaude(articles: Article[]): Promise<string>;
    getActiveSubscribers(): Promise<Subscriber[]>;
    sendWhatsAppMessage(phoneNumber: string, message: string): Promise<void>;
}
```

### Activity Implementations

#### `fetchRssHeadlines`

Uses `fast-xml-parser` to parse two ABC News RSS feeds:

```typescript
import { XMLParser } from 'fast-xml-parser';

const RSS_FEEDS = [
    'https://www.abc.net.au/news/feed/2942460/rss.xml',  // Top Stories
    'https://www.abc.net.au/news/feed/51120/rss.xml',     // Just In
];

export async function fetchRssHeadlines(): Promise<Headline[]> {
    const parser = new XMLParser({ ignoreAttributes: false });
    const allHeadlines: Headline[] = [];

    for (const feedUrl of RSS_FEEDS) {
        const response = await fetch(feedUrl);
        const xml = await response.text();
        const parsed = parser.parse(xml);
        const items = parsed.rss?.channel?.item || [];

        for (const item of items) {
            allHeadlines.push({
                title: item.title,
                link: item.link,
                pubDate: item.pubDate,
            });
        }
    }

    // Deduplicate by link
    const seen = new Set<string>();
    return allHeadlines.filter(h => {
        if (seen.has(h.link)) return false;
        seen.add(h.link);
        return true;
    });
}
```

#### `scrapeArticles`

Fetches article HTML and extracts text content using `cheerio`:

```typescript
import * as cheerio from 'cheerio';

export async function scrapeArticles(headlines: Headline[]): Promise<Article[]> {
    const articles: Article[] = [];

    for (const headline of headlines) {
        try {
            const response = await fetch(headline.link);
            const html = await response.text();
            const $ = cheerio.load(html);

            // ABC News article content is in [data-component="BodyBlock"]
            const paragraphs = $('[data-component="BodyBlock"] p')
                .map((_, el) => $(el).text().trim())
                .get()
                .filter(Boolean);

            articles.push({
                title: headline.title,
                link: headline.link,
                content: paragraphs.join('\n'),
            });
        } catch (err) {
            // Skip articles that fail to scrape
            console.warn(`Failed to scrape ${headline.link}:`, err);
        }
    }

    return articles;
}
```

#### `summarizeWithClaude`

Invokes Claude Code CLI via `kubectl exec` into a pod that has it installed:

```typescript
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

const CLAUDE_POD_LABEL = process.env.CLAUDE_POD_LABEL || 'app=claude-code';
const CLAUDE_NAMESPACE = process.env.CLAUDE_NAMESPACE || 'default';

export async function summarizeWithClaude(articles: Article[]): Promise<string> {
    const articleText = articles
        .map((a, i) => `${i + 1}. ${a.title}\n${a.content}\n`)
        .join('\n---\n');

    const prompt = `You are a news digest formatter for WhatsApp. Summarize these ${articles.length} ABC News articles into a concise daily digest. Format for WhatsApp (use *bold* for headlines, keep summaries to 1-2 sentences each). Start with a greeting and date. Maximum 20 articles.\n\nArticles:\n${articleText}`;

    // Get pod name via label selector
    const { stdout: podName } = await execFileAsync('kubectl', [
        'get', 'pods',
        '-n', CLAUDE_NAMESPACE,
        '-l', CLAUDE_POD_LABEL,
        '-o', 'jsonpath={.items[0].metadata.name}',
    ]);

    // Execute claude CLI in the pod
    const { stdout: digest } = await execFileAsync('kubectl', [
        'exec', '-n', CLAUDE_NAMESPACE, podName.trim(),
        '--', 'claude', '-p', prompt, '--output-format', 'text',
    ], { timeout: 120000 });

    return digest.trim();
}
```

**Security note:** Uses `execFile` with an argument array (not `exec` with string interpolation) to prevent shell injection. The prompt content is passed as a single argument, not interpolated into a shell command.

#### `getActiveSubscribers`

Direct DB query joining `news_subscriptions` with `sessions` to get phone numbers:

```typescript
import pg from 'pg';

const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    max: 5,
});

export async function getActiveSubscribers(): Promise<Subscriber[]> {
    const result = await pool.query(`
        SELECT ns.user_id, s.phone_number
        FROM news_subscriptions ns
        JOIN sessions s ON s.user_id = ns.user_id
        WHERE ns.subscribed = true
          AND s.status = 'connected'
          AND s.phone_number IS NOT NULL
    `);

    return result.rows.map(row => ({
        userId: row.user_id,
        phoneNumber: row.phone_number,
    }));
}
```

#### `sendWhatsAppMessage`

Calls the existing WhatsApp `/api/send` endpoint using a Keycloak service account token:

```typescript
const WHATSAPP_URL = process.env.WHATSAPP_URL || 'http://whatsapp.whatsapp.svc.cluster.local:3000';
const KEYCLOAK_URL = process.env.KEYCLOAK_URL || 'http://keycloak.keycloak.svc.cluster.local';
const KEYCLOAK_REALM = process.env.KEYCLOAK_REALM || 'homekube';
const CLIENT_ID = process.env.KEYCLOAK_CLIENT_ID || 'news-worker';
const CLIENT_SECRET = process.env.KEYCLOAK_CLIENT_SECRET!;
const SENDER_USER_ID = process.env.NEWS_SENDER_USER_ID!;

async function getServiceToken(): Promise<string> {
    const tokenUrl = `${KEYCLOAK_URL}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/token`;

    const response = await fetch(tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            grant_type: 'client_credentials',
            client_id: CLIENT_ID,
            client_secret: CLIENT_SECRET,
        }),
    });

    if (!response.ok) {
        throw new Error(`Failed to get service token: ${response.status}`);
    }

    const data = await response.json();
    return data.access_token;
}

export async function sendWhatsAppMessage(phoneNumber: string, message: string): Promise<void> {
    const token = await getServiceToken();

    const response = await fetch(`${WHATSAPP_URL}/api/send`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            userId: SENDER_USER_ID,
            recipientPhone: phoneNumber,
            message,
        }),
    });

    if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(`WhatsApp send failed (${response.status}): ${body.error || 'unknown'}`);
    }
}
```

The service account (`news-worker`) must have the `whatsapp-service` Keycloak realm role to use the `userId` parameter for cross-user sending via `resolveUserId()`.

## 7. Kubernetes Deployment

### ServiceAccount + RBAC

The worker needs `kubectl exec` access to invoke Claude Code in a pod:

```yaml
# k8s/news-digest-worker/rbac.yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: news-digest-worker
  namespace: news-digest
---
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: news-digest-kubectl
  namespace: default
rules:
  - apiGroups: [""]
    resources: ["pods"]
    verbs: ["get", "list"]
  - apiGroups: [""]
    resources: ["pods/exec"]
    verbs: ["create"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: news-digest-kubectl-binding
  namespace: default
subjects:
  - kind: ServiceAccount
    name: news-digest-worker
    namespace: news-digest
roleRef:
  kind: Role
  name: news-digest-kubectl
  apiGroup: rbac.authorization.k8s.io
```

### Deployment

```yaml
# k8s/news-digest-worker/deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: news-digest-worker
  namespace: news-digest
spec:
  replicas: 1
  selector:
    matchLabels:
      app: news-digest-worker
  template:
    metadata:
      labels:
        app: news-digest-worker
    spec:
      serviceAccountName: news-digest-worker
      containers:
        - name: worker
          image: registry.local/news-digest-worker:latest
          env:
            - name: TEMPORAL_ADDRESS
              value: "temporal-frontend.temporal.svc.cluster.local:7233"
            - name: TEMPORAL_NAMESPACE
              value: "default"
            - name: DATABASE_URL
              valueFrom:
                secretKeyRef:
                  name: whatsapp-db-credentials
                  key: url
            - name: WHATSAPP_URL
              value: "http://whatsapp.whatsapp.svc.cluster.local:3000"
            - name: KEYCLOAK_URL
              value: "http://keycloak.keycloak.svc.cluster.local"
            - name: KEYCLOAK_REALM
              value: "homekube"
            - name: KEYCLOAK_CLIENT_ID
              value: "news-worker"
            - name: KEYCLOAK_CLIENT_SECRET
              valueFrom:
                secretKeyRef:
                  name: news-digest-keycloak
                  key: client-secret
            - name: NEWS_SENDER_USER_ID
              valueFrom:
                configMapKeyRef:
                  name: news-digest-config
                  key: sender-user-id
            - name: CLAUDE_POD_LABEL
              value: "app=claude-code"
            - name: CLAUDE_NAMESPACE
              value: "default"
```

### Dockerfile

```dockerfile
# Multi-stage build with kubectl for exec capability
FROM node:20-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-slim
WORKDIR /app

# Install kubectl
RUN apt-get update && apt-get install -y curl && \
    curl -LO "https://dl.k8s.io/release/$(curl -L -s https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl" && \
    install -o root -g root -m 0755 kubectl /usr/local/bin/kubectl && \
    rm kubectl && apt-get remove -y curl && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./

CMD ["node", "dist/worker.js"]
```

## 8. Schedule Registration

Register the Temporal schedule using the TypeScript SDK:

```typescript
// scripts/register-schedule.ts
import { Client, Connection } from '@temporalio/client';
import { ScheduleOverlapPolicy } from '@temporalio/client';

async function main() {
    const connection = await Connection.connect({
        address: process.env.TEMPORAL_ADDRESS || 'localhost:7233',
    });

    const client = new Client({ connection });

    const scheduleId = 'daily-news-digest';

    try {
        // Delete existing schedule if present (for idempotent re-registration)
        const existingHandle = client.schedule.getHandle(scheduleId);
        await existingHandle.delete();
        console.log(`Deleted existing schedule: ${scheduleId}`);
    } catch {
        // Schedule doesn't exist yet -- that's fine
    }

    await client.schedule.create({
        scheduleId,
        spec: {
            calendars: [
                {
                    hour: 9,
                    minute: 0,
                },
            ],
            timezone: 'Australia/Sydney',
        },
        action: {
            type: 'startWorkflow',
            workflowType: 'DailyNewsDigestWorkflow',
            taskQueue: 'news-digest',
        },
        policies: {
            overlap: ScheduleOverlapPolicy.SKIP,
        },
    });

    console.log(`Schedule "${scheduleId}" created: 9:00 AM Australia/Sydney daily`);
    console.log('Overlap policy: SKIP (if previous run still running, skip this execution)');
}

main().catch(console.error);
```

### Schedule Behavior

| Scenario | Behavior |
|----------|----------|
| Normal execution at 9 AM AEST | Workflow starts, fetches/summarizes/delivers |
| Previous workflow still running at 9 AM | Skipped (SKIP overlap policy) |
| DST transition (AEST to AEDT) | Temporal adjusts automatically via `Australia/Sydney` timezone |
| Worker pod restarted | Temporal re-delivers pending workflow tasks |
| Worker pod down at scheduled time | Temporal queues the workflow, executes when worker reconnects |

## 9. Keycloak Configuration

### Create `news-worker` Confidential Client

1. Go to **Clients** in left menu
2. Click **Create client**
3. Set **Client ID**: `news-worker`
4. Set **Client authentication**: ON (confidential)
5. Enable **Service accounts roles** (under Authentication flow)
6. Click **Save**
7. Go to **Credentials** tab and copy the **Client secret**

### Assign `whatsapp-service` Realm Role

1. Go to **Clients** -> `news-worker` -> **Service account roles** tab
2. Click **Assign role**
3. Select `whatsapp-service` (the role created during whatsapp-authz setup)
4. Click **Assign**

### Add `whatsapp` Client Scope

1. Go to **Clients** -> `news-worker` -> **Client scopes** tab
2. Click **Add client scope**
3. Select `whatsapp` scope
4. Click **Add** (as Default)

This ensures the service account token includes the `whatsapp` audience and the `whatsapp-service` realm role, allowing it to call `/api/send` with a `userId` parameter for cross-user sending.

The role appears in the JWT as:
```json
{
    "realm_access": {
        "roles": ["whatsapp-service", "default-roles-homekube"]
    }
}
```

## 10. File Change Summary

| File | Change Type | Description |
|------|-------------|-------------|
| `whatsapp/src/migrations/002_news_subscriptions.sql` | Create | New migration: `news_subscriptions` table |
| `whatsapp/src/db.ts` | Modify | Upgrade `runMigrations()` to sequential runner with `schema_migrations` tracking |
| `whatsapp/src/routes/rest.ts` | Modify | Add `/api/news/subscribe`, `/api/news/unsubscribe`, `/api/news/subscription-status` routes |
| `homepage/src/routes/api/whatsapp/news/subscribe/+server.ts` | Create | SvelteKit proxy route for subscribe |
| `homepage/src/routes/api/whatsapp/news/unsubscribe/+server.ts` | Create | SvelteKit proxy route for unsubscribe |
| `homepage/src/routes/api/whatsapp/news/status/+server.ts` | Create | SvelteKit proxy route for subscription status |
| `homepage/src/routes/WhatsAppTab.svelte` | Modify | Add news subscription UI section with toggle |
| `news-digest-worker/src/workflows.ts` | Create | `DailyNewsDigestWorkflow` definition |
| `news-digest-worker/src/activities.ts` | Create | Activity implementations (RSS, scrape, Claude, subscribers, send) |
| `news-digest-worker/src/worker.ts` | Create | Temporal worker bootstrap |
| `news-digest-worker/Dockerfile` | Create | Multi-stage build with kubectl |
| `news-digest-worker/package.json` | Create | Dependencies: `@temporalio/*`, `fast-xml-parser`, `cheerio`, `pg` |
| `k8s/news-digest-worker/deployment.yaml` | Create | Kubernetes Deployment manifest |
| `k8s/news-digest-worker/rbac.yaml` | Create | ServiceAccount + Role + RoleBinding for kubectl exec |
| `scripts/register-schedule.ts` | Create | Temporal schedule registration script |

## REFERENCES

| Topic | Location |
|-------|----------|
| Strategic blueprint | [news-digest-blueprint.md](news-digest-blueprint.md) |
| WhatsApp auth & authz | [whatsapp/src/auth.ts](../whatsapp/src/auth.ts) |
| WhatsApp REST routes | [whatsapp/src/routes/rest.ts](../whatsapp/src/routes/rest.ts) |
| WhatsApp DB + migrations | [whatsapp/src/db.ts](../whatsapp/src/db.ts) |
| News subscriptions migration | [whatsapp/src/migrations/002_news_subscriptions.sql](../whatsapp/src/migrations/002_news_subscriptions.sql) |
| Homepage WhatsApp tab | [homepage/src/routes/WhatsAppTab.svelte](../homepage/src/routes/WhatsAppTab.svelte) |
| Homepage news proxy routes | [homepage/src/routes/api/whatsapp/news/](../homepage/src/routes/api/whatsapp/news/) |
| Temporal infrastructure | [temporal/](../temporal/) |
| Keycloak setup | [keycloak/SETUP.md](../keycloak/SETUP.md) |
| WhatsApp authz blueprint | [whatsapp-authz-blueprint.md](whatsapp-authz-blueprint.md) |
| WhatsApp authz spec | [whatsapp-authz-spec.md](whatsapp-authz-spec.md) |
