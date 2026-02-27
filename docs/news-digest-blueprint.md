# Daily ABC News Digest (Strategic)

## 1. Problem Statement

Users in the homekube ecosystem have no automated way to receive curated daily news summaries. The WhatsApp service supports messaging, but there is no scheduled content delivery system. Users must manually browse news sources to stay informed.

**Implementation Implication:** The system should fetch ABC News headlines daily, generate AI summaries via Claude Code CLI, and deliver them to opted-in subscribers via WhatsApp. A designated sender account (configurable via `NEWS_SENDER_USER_ID`) sends FROM their WhatsApp session TO each subscriber's phone number.

## 2. Success Metrics

- Daily digest delivered at 9 AM AEST to all opted-in subscribers
- RSS headlines fetched from ABC News (top stories and just in feeds)
- AI-generated summaries via Claude Code CLI formatted for WhatsApp
- WhatsApp delivery to every opted-in subscriber's phone number
- Users can self-service opt-in/out from the homepage UI
- Schedule handles AEST/AEDT daylight saving transitions automatically

**Implementation Implication:** The Temporal schedule must use `Australia/Sydney` timezone to handle DST transitions. The designated sender's WhatsApp session must remain linked and connected.

## 3. Architecture Decision

Use Temporal for workflow orchestration with a dedicated worker service:

| Component | Technology | Purpose |
|-----------|-----------|---------|
| Scheduler | Temporal Calendar Schedule | 9 AM AEST daily trigger with DST handling |
| Workflow | TypeScript Temporal workflow | Orchestrate fetch -> scrape -> summarize -> deliver |
| RSS parsing | `fast-xml-parser` | Parse ABC News RSS feeds |
| Article scraping | `cheerio` | Extract article text from HTML |
| AI summary | Claude Code CLI via `kubectl exec` | Generate WhatsApp-formatted digest |
| Subscriber DB | WhatsApp Postgres (`news_subscriptions` table) | Track opt-in/out state |
| Delivery | WhatsApp `/api/send` endpoint | Send from designated user's session |

**Decision:** Direct DB read for subscriber lookup (read-only query joining `news_subscriptions` with `sessions`), HTTP API for message sending (uses existing auth + delivery pipeline). Claude Code CLI invoked via `kubectl exec` into a running pod.

**Rationale:** The worker needs subscriber phone numbers which requires joining the `sessions` table. Using the send API ensures messages go through the existing WhatsApp delivery pipeline with proper logging and error handling. `kubectl exec` avoids embedding Claude API keys in the worker -- it delegates to a pod that already has CLI access.

## 4. What We're Building (MVP)

1. `news_subscriptions` table in WhatsApp DB
2. Subscription management API routes (subscribe/unsubscribe/status) in WhatsApp service
3. Homepage UI toggle in WhatsApp tab for news subscription
4. Temporal workflow with activities: `fetchRssHeadlines`, `scrapeArticles`, `summarizeWithClaude`, `getActiveSubscribers`, `sendWhatsAppMessage`
5. Kubernetes deployment with RBAC for `kubectl exec` pod access
6. Temporal schedule for daily 9 AM AEST execution

**Implementation Implication:** Changes span three services (WhatsApp backend, homepage frontend, new Temporal worker) plus Kubernetes manifests and Keycloak configuration. The WhatsApp service gains new routes while remaining backward-compatible.

## 5. What We're NOT Building

- No custom RSS feed selection (ABC News only for MVP)
- No per-user summary preferences or topic filtering
- No message delivery receipts or retry tracking
- No admin dashboard for subscription management
- No historical digest archive or web-based digest viewer

## REFERENCES

### Implementation Details Location

| Content Type | Location |
|--------------|----------|
| Database schema | [Implementation Spec, Section 1](news-digest-spec.md#1-database-schema) |
| Migration runner | [Implementation Spec, Section 2](news-digest-spec.md#2-migration-runner-upgrade) |
| Subscription routes | [Implementation Spec, Section 3](news-digest-spec.md#3-whatsapp-subscription-routes) |
| Homepage changes | [Implementation Spec, Sections 4-5](news-digest-spec.md#4-homepage-proxy-routes) |
| Temporal workflow | [Implementation Spec, Section 6](news-digest-spec.md#6-temporal-workflow-dailynewsdigestworkflow) |
| Kubernetes deployment | [Implementation Spec, Section 7](news-digest-spec.md#7-kubernetes-deployment) |
| Keycloak configuration | [Implementation Spec, Section 9](news-digest-spec.md#9-keycloak-configuration) |

### Existing Code References

| Topic | Location |
|-------|----------|
| WhatsApp auth & authz | [whatsapp/src/auth.ts](../whatsapp/src/auth.ts) |
| WhatsApp REST routes | [whatsapp/src/routes/rest.ts](../whatsapp/src/routes/rest.ts) |
| WhatsApp DB + migrations | [whatsapp/src/db.ts](../whatsapp/src/db.ts) |
| News subscriptions migration | [whatsapp/src/migrations/002_news_subscriptions.sql](../whatsapp/src/migrations/002_news_subscriptions.sql) |
| Homepage WhatsApp tab | [homepage/src/routes/WhatsAppTab.svelte](../homepage/src/routes/WhatsAppTab.svelte) |
| Homepage proxy routes | [homepage/src/routes/api/whatsapp/news/](../homepage/src/routes/api/whatsapp/news/) |
| Temporal infrastructure | [temporal/](../temporal/) |
| Keycloak setup | [keycloak/SETUP.md](../keycloak/SETUP.md) |

*This document provides strategic overview. See [Implementation Spec](news-digest-spec.md) for technical details.*
