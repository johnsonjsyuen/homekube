# Economist Digest Implementation Spec (Implementation)

## 1. Database Migration

New migration file: `news-worker/src/migrations/002_economist_subscriptions.sql`

```sql
CREATE TABLE IF NOT EXISTS economist_subscriptions (
    user_id      TEXT PRIMARY KEY,
    subscribed   BOOLEAN NOT NULL DEFAULT TRUE,
    subscribed_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_economist_subscriptions_active
    ON economist_subscriptions (subscribed) WHERE subscribed = true;
```

Identical schema to `news_subscriptions`. Separate table so users subscribe independently to ABC News and Economist digests.

| Column | Type | Purpose |
|--------|------|---------|
| `user_id` | `TEXT PK` | Correlates with `sessions.user_id` |
| `subscribed` | `BOOLEAN` | Soft opt-in/out toggle |
| `subscribed_at` | `TIMESTAMPTZ` | First subscription time |
| `updated_at` | `TIMESTAMPTZ` | Last toggle time |

## 2. Activities

All new activities go in `news-worker/src/activities/`. Follow the existing pattern: one file per activity, all re-exported from `index.ts`.

### 2.1 `fetchEconomistHeadlines` — `news-worker/src/activities/fetchEconomistRss.ts`

Fetches from 3 Economist RSS feeds:

| Feed | URL |
|------|-----|
| Leaders | `https://www.economist.com/leaders/rss.xml` |
| Finance & Economics | `https://www.economist.com/finance-and-economics/rss.xml` |
| Business | `https://www.economist.com/business/rss.xml` |

```typescript
import { XMLParser } from 'fast-xml-parser';

export interface EconomistHeadline {
    title: string;
    link: string;
    pubDate: string;
    description: string;
}

const ECONOMIST_RSS_FEEDS = [
    'https://www.economist.com/leaders/rss.xml',
    'https://www.economist.com/finance-and-economics/rss.xml',
    'https://www.economist.com/business/rss.xml',
];

export async function fetchEconomistHeadlines(): Promise<EconomistHeadline[]> {
    const parser = new XMLParser({ ignoreAttributes: false });
    const allItems: EconomistHeadline[] = [];
    const seenLinks = new Set<string>();

    for (const feedUrl of ECONOMIST_RSS_FEEDS) {
        try {
            const response = await fetch(feedUrl, {
                headers: { 'User-Agent': 'Lamarr' },
            });
            if (!response.ok) {
                console.warn(`[Economist RSS] Failed to fetch ${feedUrl}: ${response.status}`);
                continue;
            }
            const xml = await response.text();
            const parsed = parser.parse(xml);
            const items = parsed?.rss?.channel?.item || [];
            const itemList = Array.isArray(items) ? items : [items];

            for (const item of itemList) {
                const link = item.link || '';
                if (link && !seenLinks.has(link)) {
                    seenLinks.add(link);
                    allItems.push({
                        title: (item.title || '').replace(/^\s+|\s+$/g, ''),
                        link,
                        pubDate: item.pubDate || '',
                        description: (item.description || '').replace(/^\s+|\s+$/g, ''),
                    });
                }
            }
        } catch (err) {
            console.error(`[Economist RSS] Error fetching ${feedUrl}:`, err);
        }
    }

    // Sort by date descending, take top 15
    allItems.sort((a, b) => new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime());
    return allItems.slice(0, 15);
}
```

**Differences from ABC `fetchRssHeadlines`:**
- Different RSS feed URLs
- Uses `Lamarr` user agent
- Caps at 15 (Economist articles are longer/denser than ABC)
- CDATA content has whitespace trimmed

### 2.2 `scrapeEconomistArticles` — `news-worker/src/activities/scrapeEconomistArticles.ts`

Uses the same scraping logic as `get-article.ts`: fetch HTML, parse with `linkedom`, remove noise elements, extract `<article>` text. Falls back to RSS description when scraping fails (Cloudflare 403).

```typescript
import { parseHTML } from 'linkedom';
import type { EconomistHeadline } from './fetchEconomistRss.js';

export interface EconomistArticle {
    title: string;
    link: string;
    text: string;
}

const USER_AGENT = 'Lamarr';

const REMOVE_SELECTORS = [
    'script', 'style', 'nav', 'footer', 'header', 'aside',
    'figure', 'img', 'svg', 'iframe', 'noscript',
    "[class*='ad']", "[class*='Ad']",
];

export async function scrapeEconomistArticles(headlines: EconomistHeadline[]): Promise<EconomistArticle[]> {
    const articles: EconomistArticle[] = [];

    for (const headline of headlines) {
        let text = '';

        try {
            const response = await fetch(headline.link, {
                headers: { 'User-Agent': USER_AGENT },
            });

            if (response.ok) {
                const html = await response.text();
                const { document } = parseHTML(html);

                for (const sel of REMOVE_SELECTORS) {
                    document.querySelectorAll(sel).forEach((el: any) => el.remove());
                }

                const article = document.querySelector('article') ?? document.body;
                text = article.textContent
                    .replace(/[ \t]+/g, ' ')
                    .split('\n')
                    .map((l: string) => l.trim())
                    .filter(Boolean)
                    .join('\n');

                // Limit text length
                if (text.length > 3000) {
                    text = text.slice(0, 3000) + '...';
                }
            }
        } catch (err) {
            console.warn(`[Economist Scrape] Failed to scrape ${headline.link}:`, err);
        }

        // Fallback: use RSS description if scraping failed or returned too little text
        if (text.length < 100 && headline.description) {
            text = headline.description;
            console.log(`[Economist Scrape] Using RSS description for: ${headline.title}`);
        }

        if (text.length > 0) {
            articles.push({
                title: headline.title,
                link: headline.link,
                text,
            });
        }
    }

    return articles;
}
```

**Key difference from ABC `scrapeArticles`:** Uses `linkedom` (same as `get-article.ts`) instead of regex-based HTML stripping. Falls back to RSS `description` field when scraping fails due to Cloudflare.

### 2.3 `summariseEconomistWithClaude` — reuse `summariseWithClaude` with different prompt

Rather than creating a separate activity, add an optional `source` parameter to the existing `summariseWithClaude` or create a thin wrapper:

New file: `news-worker/src/activities/summariseEconomistWithClaude.ts`

```typescript
import { execFile } from 'child_process';
import { promisify } from 'util';
import type { EconomistArticle } from './scrapeEconomistArticles.js';

const execFileAsync = promisify(execFile);

const CLAUDE_CODE_NAMESPACE = process.env.CLAUDE_CODE_NAMESPACE || 'default';
const CLAUDE_CODE_LABEL = process.env.CLAUDE_CODE_LABEL || 'app=claude-code';

export async function summariseEconomistWithClaude(articles: EconomistArticle[]): Promise<string> {
    const { stdout: podName } = await execFileAsync('kubectl', [
        'get', 'pods',
        '-n', CLAUDE_CODE_NAMESPACE,
        '-l', CLAUDE_CODE_LABEL,
        '--field-selector=status.phase=Running',
        '-o', 'jsonpath={.items[0].metadata.name}',
    ]);

    if (!podName || podName === '') {
        throw new Error('No running Claude Code pod found');
    }

    const articleText = articles
        .map((a, i) => `Article ${i + 1}: ${a.title}\nURL: ${a.link}\n${a.text}`)
        .join('\n\n---\n\n');

    const promptString = `You are a news digest assistant. Summarise the following articles from The Economist into a WhatsApp-friendly weekly digest.

Format rules:
- Start with a greeting line: "*The Economist Digest*" followed by today's date
- For each article, use *bold* for the headline title
- Write 1-2 sentence summary for each article
- After each summary, include the original article URL on its own line so readers can tap to read more
- Keep the total digest concise and readable on a phone screen
- Use plain text formatting suitable for WhatsApp (no markdown links, just *bold* for emphasis and plain URLs)
- Number each article
- End with a sign-off line

Here are the articles:

${articleText}`;

    const child = execFileAsync('kubectl', [
        'exec', '-n', CLAUDE_CODE_NAMESPACE, podName.trim(), '-i', '--',
        'claude', '--output-format', 'text', '-p', '-',
    ], { maxBuffer: 1024 * 1024, timeout: 120000 });

    child.child.stdin?.write(promptString);
    child.child.stdin?.end();

    const { stdout: digest } = await child;

    if (!digest || digest.trim() === '') {
        throw new Error('Claude returned empty digest');
    }

    return digest.trim();
}
```

**Differences from ABC version:** Prompt says "The Economist" instead of "Australian news", greeting uses "*The Economist Digest*".

### 2.4 `getEconomistSubscribers` — `news-worker/src/activities/getEconomistSubscribers.ts`

```typescript
import pg from 'pg';
import pool from '../db.js';

export interface Subscriber {
    userId: string;
    phone: string;
}

const whatsappPool = new pg.Pool({
    connectionString: process.env.WHATSAPP_DATABASE_URL,
    max: 2,
});

export async function getEconomistSubscribers(): Promise<Subscriber[]> {
    const subscriptions = await pool.query(
        `SELECT user_id FROM economist_subscriptions WHERE subscribed = TRUE`
    );

    if (subscriptions.rows.length === 0) {
        return [];
    }

    const userIds = subscriptions.rows.map((r: any) => r.user_id);

    const sessions = await whatsappPool.query(
        `SELECT user_id, whatsapp_jid FROM sessions
         WHERE user_id = ANY($1) AND status = 'connected'`,
        [userIds]
    );

    return sessions.rows
        .filter((row: any) => row.whatsapp_jid)
        .map((row: any) => {
            const phone = row.whatsapp_jid.split(':')[0].split('@')[0];
            return { userId: row.user_id, phone };
        });
}
```

**Only difference from ABC `getSubscribers`:** Queries `economist_subscriptions` instead of `news_subscriptions`.

### 2.5 Reuse `sendDigest`

The existing `sendDigest` activity is generic — it takes `{ digest, subscribers }` and sends via WhatsApp. No changes needed.

### 2.6 Update `index.ts` exports

Add new exports to `news-worker/src/activities/index.ts`:

```typescript
export { fetchRssHeadlines } from './fetchRss.js';
export { scrapeArticles } from './scrapeArticles.js';
export { summariseWithClaude } from './summariseWithClaude.js';
export { getSubscribers } from './getSubscribers.js';
export { sendDigest } from './sendDigest.js';
// Economist activities
export { fetchEconomistHeadlines } from './fetchEconomistRss.js';
export { scrapeEconomistArticles } from './scrapeEconomistArticles.js';
export { summariseEconomistWithClaude } from './summariseEconomistWithClaude.js';
export { getEconomistSubscribers } from './getEconomistSubscribers.js';
```

## 3. Workflow

New file: `news-worker/src/economistWorkflow.ts`

```typescript
import { proxyActivities, log } from '@temporalio/workflow';
import type * as activities from './activities/index.js';

const {
    fetchEconomistHeadlines,
    scrapeEconomistArticles,
    summariseEconomistWithClaude,
    getEconomistSubscribers,
    sendDigest,
} = proxyActivities<typeof activities>({
    startToCloseTimeout: '5 minutes',
    retry: { maximumAttempts: 3 },
});

export async function EconomistDigestWorkflow(): Promise<string> {
    log.info('Starting Economist digest workflow');

    // Step 1: Fetch RSS headlines
    const headlines = await fetchEconomistHeadlines();
    log.info(`Fetched ${headlines.length} Economist headlines`);

    if (headlines.length === 0) {
        log.warn('No Economist headlines found, skipping digest');
        return 'No headlines found';
    }

    // Step 2: Scrape article text (with RSS fallback)
    const articles = await scrapeEconomistArticles(headlines);
    log.info(`Scraped ${articles.length} Economist articles`);

    // Step 3: Summarise with Claude
    const digest = await summariseEconomistWithClaude(articles);
    log.info('Generated Economist digest summary');

    // Step 4: Get subscribers
    const subscribers = await getEconomistSubscribers();
    log.info(`Found ${subscribers.length} Economist subscribers`);

    if (subscribers.length === 0) {
        log.warn('No Economist subscribers, skipping delivery');
        return 'No subscribers';
    }

    // Step 5: Send digest
    await sendDigest({ digest, subscribers });
    log.info(`Economist digest sent to ${subscribers.length} subscribers`);

    return `Economist digest sent to ${subscribers.length} subscribers`;
}
```

### Worker Registration

Update `news-worker/src/index.ts` to register the new workflow. The Temporal worker's `workflowsPath` already points to a directory — we need to ensure the new workflow file is discoverable. Since Temporal uses `workflowsPath` to load workflow files, add the economist workflow to the same file or ensure the worker can find it.

**Option chosen:** Add the economist workflow export alongside the existing workflow. Update the `workflowsPath` approach:

The worker currently uses:
```typescript
workflowsPath: new URL('./workflow.js', import.meta.url).pathname,
```

This only loads `workflow.ts`. To load both workflows, either:
- Export both from the same file (simplest), OR
- Use `workflowsPath` pointing to a barrel file

**Chosen approach:** Add the Economist workflow export to `workflow.ts` by re-exporting from the new file:

```typescript
// At the end of workflow.ts
export { EconomistDigestWorkflow } from './economistWorkflow.js';
```

## 4. Routes

Add Economist routes to `news-worker/src/routes.ts`:

```typescript
// POST /economist/subscribe
router.post('/economist/subscribe', async (req, res) => {
    try {
        const user = (req as any).user as TokenPayload;
        const userId = getCallerUserId(user);

        await pool.query(
            `INSERT INTO economist_subscriptions (user_id, subscribed, subscribed_at, updated_at)
             VALUES ($1, TRUE, NOW(), NOW())
             ON CONFLICT (user_id)
             DO UPDATE SET subscribed = TRUE, updated_at = NOW()`,
            [userId]
        );

        res.json({ subscribed: true });
    } catch (err: any) {
        console.error('[REST] Economist subscribe error:', err);
        res.status(500).json({ error: err.message });
    }
});

// POST /economist/unsubscribe
router.post('/economist/unsubscribe', async (req, res) => {
    try {
        const user = (req as any).user as TokenPayload;
        const userId = getCallerUserId(user);

        await pool.query(
            `INSERT INTO economist_subscriptions (user_id, subscribed, updated_at)
             VALUES ($1, FALSE, NOW())
             ON CONFLICT (user_id)
             DO UPDATE SET subscribed = FALSE, updated_at = NOW()`,
            [userId]
        );

        res.json({ subscribed: false });
    } catch (err: any) {
        console.error('[REST] Economist unsubscribe error:', err);
        res.status(500).json({ error: err.message });
    }
});

// GET /economist/subscription-status
router.get('/economist/subscription-status', async (req, res) => {
    try {
        const user = (req as any).user as TokenPayload;
        const userId = getCallerUserId(user);

        const result = await pool.query(
            'SELECT subscribed FROM economist_subscriptions WHERE user_id = $1',
            [userId]
        );

        res.json({ subscribed: result.rows.length > 0 && result.rows[0].subscribed });
    } catch (err: any) {
        console.error('[REST] Economist subscription status error:', err);
        res.status(500).json({ error: err.message });
    }
});

// POST /economist/trigger
router.post('/economist/trigger', async (req, res) => {
    try {
        const { Connection, Client } = await import('@temporalio/client');
        const connection = await Connection.connect({
            address: process.env.TEMPORAL_ADDRESS || 'temporal-frontend:7233',
        });
        const client = new Client({ connection });
        const workflowId = `economist-digest-manual-${Date.now()}`;
        const handle = await client.workflow.start('EconomistDigestWorkflow', {
            taskQueue: 'news-digest-queue',
            workflowId,
        });
        res.json({ workflowId: handle.workflowId, message: 'Economist workflow started' });
    } catch (err: any) {
        console.error('[REST] Economist trigger error:', err);
        res.status(500).json({ error: err.message });
    }
});
```

## 5. Homepage Proxy Routes

4 new SvelteKit server routes under `homepage/src/routes/api/whatsapp/economist/`:

### `subscribe/+server.ts`

```typescript
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
    const authHeader = request.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return json({ error: 'Unauthorized: Missing or invalid token' }, { status: 401 });
    }

    try {
        const response = await fetch('http://news-worker.temporal.svc.cluster.local/api/economist/subscribe', {
            method: 'POST',
            headers: { 'Authorization': authHeader }
        });

        const data = await response.json();
        return json(data, { status: response.status });
    } catch (e) {
        console.error('Error proxying to economist subscribe:', e);
        return json({ error: 'Internal Server Error' }, { status: 500 });
    }
};
```

### `unsubscribe/+server.ts`

```typescript
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
    const authHeader = request.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return json({ error: 'Unauthorized: Missing or invalid token' }, { status: 401 });
    }

    try {
        const response = await fetch('http://news-worker.temporal.svc.cluster.local/api/economist/unsubscribe', {
            method: 'POST',
            headers: { 'Authorization': authHeader }
        });

        const data = await response.json();
        return json(data, { status: response.status });
    } catch (e) {
        console.error('Error proxying to economist unsubscribe:', e);
        return json({ error: 'Internal Server Error' }, { status: 500 });
    }
};
```

### `status/+server.ts`

```typescript
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ request }) => {
    const authHeader = request.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return json({ error: 'Unauthorized: Missing or invalid token' }, { status: 401 });
    }

    try {
        const response = await fetch('http://news-worker.temporal.svc.cluster.local/api/economist/subscription-status', {
            headers: { 'Authorization': authHeader }
        });

        const data = await response.json();
        return json(data, { status: response.status });
    } catch (e) {
        console.error('Error proxying to economist status:', e);
        return json({ error: 'Internal Server Error' }, { status: 500 });
    }
};
```

### `trigger/+server.ts`

```typescript
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
    const authHeader = request.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return json({ error: 'Unauthorized: Missing or invalid token' }, { status: 401 });
    }

    try {
        const response = await fetch('http://news-worker.temporal.svc.cluster.local/api/economist/trigger', {
            method: 'POST',
            headers: { 'Authorization': authHeader }
        });

        const data = await response.json();
        return json(data, { status: response.status });
    } catch (e) {
        console.error('Error proxying to economist trigger:', e);
        return json({ error: 'Internal Server Error' }, { status: 500 });
    }
};
```

## 6. Homepage UI

Add a new "Economist Digest" section to `homepage/src/routes/WorkflowsTab.svelte` below the existing "Daily News Digest" section.

### New State Variables

```typescript
let econSubscribed = $state(false);
let econLoading = $state(false);
let econError = $state('');
let econTriggerLoading = $state(false);
let econTriggerResult = $state('');
let econTriggerError = $state('');
```

### New Functions

```typescript
async function fetchEconSubscriptionStatus() {
    try {
        const token = await getFreshToken();
        if (!token) return;
        const res = await fetch('/api/whatsapp/economist/status', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        econSubscribed = data.subscribed || false;
    } catch (err: any) {
        console.error('[Workflows] Economist status fetch error:', err);
    }
}

async function toggleEconSubscription() {
    econLoading = true;
    econError = '';
    try {
        const token = await getFreshToken();
        if (!token) return;
        const endpoint = econSubscribed ? '/api/whatsapp/economist/unsubscribe' : '/api/whatsapp/economist/subscribe';
        const res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        if (!res.ok) {
            econError = data.error || 'Failed to update subscription';
            return;
        }
        econSubscribed = data.subscribed;
    } catch (err: any) {
        econError = err.message;
    } finally {
        econLoading = false;
    }
}

async function triggerEconWorkflow() {
    econTriggerLoading = true;
    econTriggerResult = '';
    econTriggerError = '';
    try {
        const token = await getFreshToken();
        if (!token) return;
        const res = await fetch('/api/whatsapp/economist/trigger', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        if (!res.ok) {
            econTriggerError = data.error || 'Failed to trigger workflow';
            return;
        }
        econTriggerResult = `Workflow started: ${data.workflowId}`;
    } catch (err: any) {
        econTriggerError = err.message;
    } finally {
        econTriggerLoading = false;
    }
}
```

### Update `$effect` block

```typescript
$effect(() => {
    if (authState.authenticated) {
        fetchSubscriptionStatus();
        fetchEconSubscriptionStatus();
    }
});
```

### New Svelte Section (below existing Daily News Digest section)

```svelte
<div class="section">
    <h4>The Economist Digest</h4>
    <p class="section-description">Get a daily AI-summarised digest of top articles from The Economist delivered to your WhatsApp at 9 AM AEST.</p>
    <div class="digest-status">
        Status: <span class="status-badge" class:status-active={econSubscribed} class:status-inactive={!econSubscribed}>
            {econSubscribed ? 'subscribed' : 'not subscribed'}
        </span>
    </div>
    {#if econSubscribed}
        <button class="unsubscribe-btn" onclick={toggleEconSubscription} disabled={econLoading}>
            {#if econLoading}
                <span class="spinner">...</span> Updating...
            {:else}
                Unsubscribe
            {/if}
        </button>
    {:else}
        <button class="subscribe-btn" onclick={toggleEconSubscription} disabled={econLoading}>
            {#if econLoading}
                <span class="spinner">...</span> Updating...
            {:else}
                Subscribe to Economist Digest
            {/if}
        </button>
    {/if}
    {#if econError}
        <div class="error-result">{econError}</div>
    {/if}

    <div class="trigger-section">
        <button class="trigger-btn" onclick={triggerEconWorkflow} disabled={econTriggerLoading}>
            {#if econTriggerLoading}
                <span class="spinner">...</span> Starting...
            {:else}
                Run Now
            {/if}
        </button>
        {#if econTriggerResult}
            <div class="success-result">{econTriggerResult}</div>
        {/if}
        {#if econTriggerError}
            <div class="error-result">{econTriggerError}</div>
        {/if}
    </div>
</div>
```

No new CSS needed — reuses existing `.section`, `.subscribe-btn`, `.unsubscribe-btn`, `.trigger-btn`, `.trigger-section` styles.

## 7. Schedule Registration

Add a new schedule in `news-worker/src/schedules/register.ts`:

```typescript
// After existing daily-news-digest schedule creation:

const economistScheduleId = 'economist-digest';

try {
    const handle = client.schedule.getHandle(economistScheduleId);
    await handle.delete();
    console.log(`[Schedule] Deleted existing schedule: ${economistScheduleId}`);
} catch {
    // Schedule doesn't exist yet
}

await client.schedule.create({
    scheduleId: economistScheduleId,
    spec: {
        calendars: [{ hour: [9], minute: [0] }],
        timezone: 'Australia/Sydney',
    },
    action: {
        type: 'startWorkflow',
        workflowType: 'EconomistDigestWorkflow',
        taskQueue: 'news-digest-queue',
    },
    policies: {
        overlap: ScheduleOverlapPolicy.SKIP,
    },
});

console.log(`[Schedule] Created schedule: ${economistScheduleId} (daily at 9:00 AM AEST/AEDT)`);
```

## 8. Dependency Addition

Add `linkedom` to `news-worker/package.json` (required by `scrapeEconomistArticles`):

```bash
cd news-worker && npm install linkedom
```

No other new dependencies — `fast-xml-parser`, `pg`, `express`, `@temporalio/*` already installed.

## 9. File Change Summary

| File | Change Type | Description |
|------|-------------|-------------|
| `news-worker/src/migrations/002_economist_subscriptions.sql` | Create | New migration: `economist_subscriptions` table |
| `news-worker/src/activities/fetchEconomistRss.ts` | Create | Fetch Economist RSS headlines |
| `news-worker/src/activities/scrapeEconomistArticles.ts` | Create | Scrape articles with `get-article.ts` logic + RSS fallback |
| `news-worker/src/activities/summariseEconomistWithClaude.ts` | Create | Claude summarization with Economist prompt |
| `news-worker/src/activities/getEconomistSubscribers.ts` | Create | Query `economist_subscriptions` table |
| `news-worker/src/activities/index.ts` | Modify | Add exports for 4 new activities |
| `news-worker/src/economistWorkflow.ts` | Create | `EconomistDigestWorkflow` definition |
| `news-worker/src/workflow.ts` | Modify | Re-export `EconomistDigestWorkflow` |
| `news-worker/src/routes.ts` | Modify | Add 4 Economist routes |
| `news-worker/src/schedules/register.ts` | Modify | Add `economist-digest` schedule |
| `news-worker/package.json` | Modify | Add `linkedom` dependency |
| `homepage/src/routes/WorkflowsTab.svelte` | Modify | Add Economist section |
| `homepage/src/routes/api/whatsapp/economist/subscribe/+server.ts` | Create | Proxy route |
| `homepage/src/routes/api/whatsapp/economist/unsubscribe/+server.ts` | Create | Proxy route |
| `homepage/src/routes/api/whatsapp/economist/status/+server.ts` | Create | Proxy route |
| `homepage/src/routes/api/whatsapp/economist/trigger/+server.ts` | Create | Proxy route |

## ANTI-PATTERNS (DO NOT)

| Don't | Do Instead | Why |
|-------|------------|-----|
| Hardcode Economist article URLs | Use RSS feeds as source of truth | Articles change daily, RSS is the canonical list |
| Fail entire workflow if scraping fails | Fall back to RSS description per article | Cloudflare blocks are expected; RSS descriptions are usable |
| Create a separate K8s deployment | Add to existing news-worker | Avoids infrastructure duplication |
| Share subscription table with ABC | Use separate `economist_subscriptions` table | Users subscribe independently to each digest |
| Create a new Temporal task queue | Reuse `news-digest-queue` | One worker process handles both workflows |
| Duplicate `sendDigest` logic | Reuse existing `sendDigest` activity | Same Keycloak + WhatsApp pipeline |
| Skip user agent on RSS requests | Always send `User-Agent: Lamarr` | Economist may block requests without user agent |

## TEST CASE SPECIFICATIONS

### Unit Tests

| Test ID | Component | Input | Expected Output | Edge Cases |
|---------|-----------|-------|-----------------|------------|
| TC-001 | fetchEconomistHeadlines | 3 RSS feeds | Array of EconomistHeadline, max 15, sorted by date | Feed returns 0 items, feed 404, duplicate links across feeds |
| TC-002 | scrapeEconomistArticles | Headlines array | Array of EconomistArticle with text | All scrapes fail (403), text < 100 chars, no RSS description |
| TC-003 | getEconomistSubscribers | Subscribed users in DB | Array of { userId, phone } | No subscriptions, user subscribed but no WhatsApp session |
| TC-004 | EconomistDigestWorkflow | Normal run | Returns "Economist digest sent to N subscribers" | 0 headlines, 0 subscribers |
| TC-005 | Routes: subscribe | POST with valid JWT | `{ subscribed: true }` | Already subscribed (upsert), invalid token |

### Integration Tests

| Test ID | Flow | Setup | Verification | Teardown |
|---------|------|-------|--------------|----------|
| IT-001 | Full workflow | Insert test subscription + mock RSS | Digest message received | Delete test subscription |
| IT-002 | Subscribe/unsubscribe | Authenticated user | DB row toggled correctly | Delete test row |
| IT-003 | Manual trigger | Authenticated user | Workflow ID returned, workflow starts in Temporal | Cancel workflow |

## ERROR HANDLING MATRIX

| Error Type | Detection | Response | Fallback | Logging |
|------------|-----------|----------|----------|---------|
| RSS feed 404/500 | HTTP status code | Skip that feed, continue others | Use remaining feeds | WARN |
| RSS feed parse error | XMLParser exception | Skip that feed | Use remaining feeds | ERROR |
| Cloudflare 403 on article | HTTP 403 status | Use RSS description | RSS description text | WARN (expected) |
| Article scrape timeout | fetch timeout (30s) | Skip article | Use RSS description | WARN |
| Claude Code pod not found | Empty kubectl output | Throw, Temporal retries (3x) | None | ERROR |
| Claude returns empty | Empty stdout | Throw, Temporal retries (3x) | None | ERROR |
| No subscribers | Empty query result | Return early, skip delivery | None | WARN |
| WhatsApp send failure | HTTP error from /api/send | Log, continue to next subscriber | None | ERROR |
| Keycloak token failure | HTTP error from token endpoint | Throw, Temporal retries (3x) | None | ERROR |
| DB connection failure | pg Pool error | Throw, Temporal retries (3x) | None | ERROR |

## REFERENCES

| Topic | Location |
|-------|----------|
| Strategic blueprint | [economist-digest-blueprint.md](economist-digest-blueprint.md) |
| Existing ABC News workflow | [news-worker/src/workflow.ts](../news-worker/src/workflow.ts) |
| Existing activities | [news-worker/src/activities/](../news-worker/src/activities/) |
| get-article.ts logic | [get-article.ts](../get-article.ts) |
| DB + migrations | [news-worker/src/db.ts](../news-worker/src/db.ts) |
| Auth middleware | [news-worker/src/auth.ts](../news-worker/src/auth.ts) |
| Routes | [news-worker/src/routes.ts](../news-worker/src/routes.ts) |
| Homepage WorkflowsTab | [homepage/src/routes/WorkflowsTab.svelte](../homepage/src/routes/WorkflowsTab.svelte) |
| Existing proxy routes | [homepage/src/routes/api/whatsapp/news/](../homepage/src/routes/api/whatsapp/news/) |
| Schedule registration | [news-worker/src/schedules/register.ts](../news-worker/src/schedules/register.ts) |
| K8s deployment | [news-worker/k8s/deploy.yaml](../news-worker/k8s/deploy.yaml) |
