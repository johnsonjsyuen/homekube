# Rewrite Strategic Blueprint (Strategic)

## Scope

Two new services replacing the current web-scraper architecture:

1. **claude-code-api** — Rust/Axum HTTP API wrapping the Claude Code CLI (replaces kubectl exec pattern)
2. **web-scraper v2** — Quarkus Kotlin rewrite of the TypeScript web-scraper service

---

## 1. The 7 Questions

### Q1: What exact problem are you solving?

**Current pain points:**

- **kubectl exec coupling** — Both `web-scraper` and `news-worker` shell out via `kubectl exec` to access Claude Code. This requires: kubectl binary in every container image, RBAC for pods/exec across namespaces, fragile pod discovery by label selector, and no connection pooling (each invocation spawns a new process).
- **TypeScript web-scraper in a Rust-dominant repo** — The repo's backend services (speedtest, text-to-speech, speech-to-text) are all Rust/Axum. The web-scraper and news-worker are TypeScript outliers. Quarkus Kotlin is chosen to introduce JVM capability for Temporal Java SDK integration while maintaining a modern, concise language.

**What we're building:**

- A proper HTTP API for Claude Code analysis requests, deployed as a Kubernetes Service, callable by any service without kubectl or RBAC for pod exec.
- A Quarkus Kotlin rewrite of the web-scraper with identical REST API surface, identical Temporal workflow behavior, and identical Kafka/Keycloak/PostgreSQL integration — but calling the new Claude Code API instead of kubectl exec.

**Implementation Implication:** The claude-code-api becomes a shared service. After this work, news-worker can also migrate from kubectl exec to HTTP calls (out of scope for this phase).

### Q2: What are your success metrics?

| Metric | Target |
|--------|--------|
| API compatibility | 100% — all 7 REST endpoints return identical JSON shape |
| Workflow behavior | Identical — same 6 activities, same retry/timeout policies |
| Claude Code latency | < 5% overhead vs kubectl exec (HTTP vs process spawn) |
| Container image size | web-scraper image drops kubectl dependency (~50MB savings) |
| Claude Code availability | HTTP health check instead of pod label discovery |
| Test coverage | Unit tests for all activities, integration test for full workflow |

### Q3: Why will you win?

- **Claude Code API** eliminates cross-namespace RBAC complexity and kubectl binary dependency from every consumer service. A single HTTP service replaces N service-specific kubectl exec implementations.
- **Quarkus Kotlin** provides native Temporal Java SDK support (first-class, not a workaround), GraalVM native-image option for fast startup, and Kotlin's concise syntax reduces boilerplate vs Java while maintaining type safety.

### Q4: What's the core architecture decision?

**ADR-001: Claude Code API as HTTP Service**

- **Decision:** Deploy a Rust/Axum HTTP API in the `default` namespace alongside the claude-code pod. The API runs `claude` CLI via `std::process::Command` (same pod or sidecar pattern not needed — the API pod has Claude Code installed directly).
- **Alternative rejected:** gRPC — adds protobuf complexity for a simple request/response pattern. REST JSON is sufficient and matches all other services in the repo.
- **Alternative rejected:** Sidecar container in claude-code pod — limits scaling and couples the API lifecycle to Claude Code updates.

**ADR-002: Temporal Java SDK for Kotlin**

- **Decision:** Use Temporal Java SDK (`io.temporal:temporal-sdk`) from Kotlin. The SDK is Kotlin-compatible (Java interop is seamless). Workflows and activities are defined as Kotlin classes/interfaces.
- **Alternative rejected:** Replace Temporal with Quarkus Scheduler — loses durable workflow execution, automatic retries, workflow history, and schedule management. Would require reimplementing all of this manually.

**ADR-003: Standalone API Pod (not sidecar)**

- **Decision:** The claude-code-api runs as its own Deployment with `@anthropic-ai/claude-code` installed. It does NOT kubectl exec into the existing claude-code pod. It is a self-contained service with its own Claude Code installation and API key.
- **Rationale:** Eliminates all kubectl/RBAC complexity. The existing claude-code pod can be decommissioned once all consumers migrate to the HTTP API.

### Q5: What's the tech stack rationale?

| Component | Choice | Rationale |
|-----------|--------|-----------|
| Claude Code API | Rust + Axum | Repo convention — 3 existing Rust/Axum services. Low memory footprint. Consistent tooling. |
| Web Scraper | Quarkus + Kotlin | Temporal Java SDK requires JVM. Kotlin over Java for conciseness. Quarkus for fast startup, built-in extensions (OIDC, health, metrics, Kafka). |
| Database | PostgreSQL (same) | No change. Same CNPG cluster, same schema. |
| Messaging | Kafka (same) | No change. Same `digests` topic. |
| Auth | Keycloak (same) | No change. `quarkus-oidc` extension replaces manual JWT validation. |
| Orchestration | Temporal (same) | No change. Same cluster, same task queue name, same schedule IDs. |

### Q6: What are the MVP features?

**Claude Code API (3 features):**

1. `POST /api/analyze` — Accept prompt, return Claude's response
2. `GET /health` — Health check (verifies Claude Code CLI is accessible)
3. `GET /metrics` — Prometheus metrics

**Web Scraper v2 (exact parity, 7 endpoints + workflow):**

1. All 7 REST API endpoints (identical request/response contracts)
2. Temporal workflow with 6 activities (loadJob, scrapeUrls, analyseWithClaude, getJobSubscribers, sendNotification, recordRun)
3. Temporal schedule management (create, update, pause, unpause, delete)
4. Prometheus metrics (same metric names and labels)

**Explicitly deferred:**
- news-worker migration to Claude Code API (future phase)
- Decommissioning existing claude-code pod (after all consumers migrate)
- Any new features beyond current web-scraper functionality

### Q7: What are you NOT building?

| Excluded | Rationale |
|----------|-----------|
| Multi-model support in Claude Code API | Only Claude Code CLI, no OpenAI/Gemini routing |
| Streaming responses | Current pattern is request/response. Streaming adds complexity for no current need |
| Authentication on Claude Code API | Internal service only (ClusterIP). Caller auth happens at web-scraper layer |
| Message queue input for Claude Code API | HTTP is sufficient. Queue-based pattern adds unnecessary complexity |
| WebSocket support | No real-time requirements for this service |
| news-worker rewrite | Separate initiative |
| Frontend changes | Homepage SvelteKit app stays unchanged — same API contract |

---

## 2. Architecture Overview

```
Homepage (SvelteKit)
  ↕ /api/scraper/* proxy routes (unchanged)
Web Scraper v2 (Quarkus Kotlin, temporal namespace)
  → Temporal Schedule (cron, Java SDK)
  → Activities:
      loadJob → PostgreSQL (same DB, same schema)
      scrapeUrls → HTTP fetch (Ktor or java.net.http)
      analyseWithClaude → HTTP POST to claude-code-api  ← NEW
      getJobSubscribers → HTTP to WhatsApp service
      sendNotification → Kafka 'digests' topic
      recordRun → PostgreSQL
  → Prometheus /metrics (Micrometer)

Claude Code API (Rust/Axum, default namespace)   ← NEW
  → Runs 'claude' CLI via std::process::Command
  → Prometheus /metrics (axum-prometheus)
```

**Implementation Implication:** The only behavioral change is the Claude Code invocation path: HTTP POST replaces kubectl exec. All other integration points (DB, Kafka, Keycloak, WhatsApp, Temporal) remain identical.

---

## 3. Migration Strategy

### Phase 1: Build Claude Code API (Rust)
- New service: `claude-code-api/`
- Deploy to `default` namespace as `claude-code-api` Service
- Verify with manual curl tests

### Phase 2: Build Web Scraper v2 (Quarkus Kotlin)
- New service: `web-scraper-kt/` (parallel to existing `web-scraper/`)
- Same DB — can read existing `scrape_jobs` and `scrape_runs` tables
- Same Temporal task queue — register worker on `web-scraper-queue`
- Same Kafka topic — produce to `digests`

### Phase 3: Cutover
- Scale down TypeScript web-scraper to 0 replicas
- Scale up Quarkus web-scraper to 1 replica
- Verify via monitoring (same Prometheus metrics, same Grafana dashboards)
- Delete TypeScript web-scraper deployment after validation

### Phase 4: Cleanup (future)
- Migrate news-worker to use claude-code-api
- Decommission existing claude-code pod and kubectl RBAC

---

## References

### Implementation Details Location

| Content Type | Location |
|--------------|----------|
| Claude Code API spec | [claude-code-api-spec.md](./01-claude-code-api-spec.md) |
| Web Scraper rewrite spec | [web-scraper-rewrite-spec.md](./02-web-scraper-rewrite-spec.md) |
| Current web-scraper spec | [web-scraper/docs/spec.md](../../web-scraper/docs/spec.md) |

### Existing Service References

| Topic | Location |
|-------|----------|
| Rust/Axum service pattern | `speedtest/src/main.rs` |
| Rust Kafka integration | `text-to-speech/src/main.rs` (rskafka) |
| Rust Keycloak JWT auth | `speech-to-text/src/main.rs` (jsonwebtoken) |
| Rust Prometheus metrics | `speedtest/src/main.rs` (axum-prometheus) |
| Current Claude exec pattern | `web-scraper/src/activities/analyseWithClaude.ts` |
| Temporal workflow pattern | `web-scraper/src/workflow.ts` |
| K8s deployment pattern | `web-scraper/k8s/deploy.yaml` |
| Build script pattern | `web-scraper/build.sh` |

*This document provides strategic overview. Implementation specifications are in the linked documents.*
