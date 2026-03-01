# Economist Digest Workflow (Strategic)

> **Migration Note (completed):** The Economist digest workflow has been merged into `workflows-worker` (Kotlin/Quarkus) along with the web scraper and news digest. The `news-worker` (TypeScript/Node.js) no longer exists as a separate service. Claude Code is invoked via HTTP to `claude-code-api` instead of kubectl exec.

## 1. Problem Statement

Users want a daily curated summary of The Economist's top articles delivered via WhatsApp, similar to the existing ABC News digest. The Economist publishes high-quality analysis across multiple sections (Leaders, Finance, Business, etc.) but articles are behind a paywall and Cloudflare protection.

**Implementation Implication:** Use Economist RSS feeds (which are publicly accessible and return titles + descriptions) as the primary source. Attempt full article scraping with "Lamarr" user agent; fall back to RSS descriptions when scraping fails (Cloudflare 403). The Economist digest workflow is now part of the `workflows-worker` (Kotlin/Quarkus) service.

## 2. Success Metrics

- Daily digest delivered at 9 AM AEST alongside (but independently of) ABC News digest
- RSS headlines fetched from 3 Economist sections: Leaders, Finance & Economics, Business
- Full article text attempted via `get-article.ts` scraping logic; RSS descriptions used as fallback
- AI-generated summaries via Claude Code CLI formatted for WhatsApp
- Independent subscription from ABC News (users can subscribe to either or both)
- Manual trigger available from homepage UI

**Implementation Implication:** Separate subscription table (`economist_subscriptions`) and separate Temporal schedule (`economist-digest`). All within the `workflows-worker` service, reusing existing infrastructure: Temporal worker, Keycloak auth, WhatsApp delivery.

## 3. Architecture Decision

The Economist digest workflow is part of the `workflows-worker` service (formerly split across `news-worker` and `web-scraper`):

| Component | Approach | Rationale |
|-----------|----------|-----------|
| Source | Economist RSS feeds | RSS works without Cloudflare; articles behind protection |
| Scraping | Article scraping logic with fallback | Attempt full text; fall back to RSS description |
| Workflow | `EconomistDigestWorkflow` in `workflows-worker` | Share infrastructure with web scraper and news digest |
| Subscriptions | Separate `economist_subscriptions` table | Independent from ABC News subscriptions |
| Task queue | `workflows-worker-queue` | One worker, multiple workflow types |
| Schedule | Separate `economist-digest` schedule | Independent trigger timing |
| Delivery | Reuse `sendDigest` activity | Same Keycloak + WhatsApp pipeline |

**Decision:** Include in `workflows-worker` (Kotlin/Quarkus) which consolidates all Temporal workflows. The worker has Temporal, Keycloak, DB, and HTTP access to claude-code-api. Adding workflows is minimal overhead.

## 4. What We're Building (MVP)

1. `economist_subscriptions` table in workflows-db (new migration)
2. `fetchEconomistHeadlines` activity — fetches RSS from 3 Economist feeds
3. `scrapeEconomistArticles` activity — uses `get-article.ts` logic; falls back to RSS descriptions
4. `summariseEconomistWithClaude` activity — Claude summarization with Economist-specific prompt
5. `getEconomistSubscribers` activity — queries `economist_subscriptions` table
6. `EconomistDigestWorkflow` — orchestrates the 5 steps
7. Subscription routes: `/economist/subscribe`, `/economist/unsubscribe`, `/economist/subscription-status`, `/economist/trigger`
8. Homepage UI section in WorkflowsTab for Economist digest
9. Homepage proxy routes under `/api/workflows/economist/`
10. Temporal schedule: `economist-digest` at 9 AM AEST daily

## 5. What We're NOT Building

- Full paywall bypass or login-based scraping
- Per-section subscription (all 3 sections bundled)
- Separate Kubernetes deployment (part of workflows-worker)
- Article caching or deduplication across days
- Custom delivery timing per user

## REFERENCES

### Implementation Details Location

| Content Type | Location |
|--------------|----------|
| Database migration | [Implementation Spec, Section 1](economist-digest-spec.md#1-database-migration) |
| Activities | [Implementation Spec, Section 2](economist-digest-spec.md#2-activities) |
| Workflow | [Implementation Spec, Section 3](economist-digest-spec.md#3-workflow) |
| Routes | [Implementation Spec, Section 4](economist-digest-spec.md#4-routes) |
| Homepage proxy routes | [Implementation Spec, Section 5](economist-digest-spec.md#5-homepage-proxy-routes) |
| Homepage UI | [Implementation Spec, Section 6](economist-digest-spec.md#6-homepage-ui) |
| Schedule registration | [Implementation Spec, Section 7](economist-digest-spec.md#7-schedule-registration) |

### Existing Code References

| Topic | Location |
|-------|----------|
| Workflows Worker source | [web-scraper-kt/](../web-scraper-kt/) (Kotlin/Quarkus implementation) |
| Workflows Worker spec | [rewrite/02-web-scraper-rewrite-spec.md](rewrite/02-web-scraper-rewrite-spec.md) |
| Homepage WorkflowsTab | [homepage/src/routes/WorkflowsTab.svelte](../homepage/src/routes/WorkflowsTab.svelte) |
| Homepage proxy routes | [homepage/src/routes/api/workflows/](../homepage/src/routes/api/workflows/) |
| get-article.ts | [get-article.ts](../get-article.ts) |
| ABC News blueprint | [news-digest-blueprint.md](news-digest-blueprint.md) |
| ABC News spec | [news-digest-spec.md](news-digest-spec.md) |

*This document provides strategic overview. See [Implementation Spec](economist-digest-spec.md) for technical details.*
