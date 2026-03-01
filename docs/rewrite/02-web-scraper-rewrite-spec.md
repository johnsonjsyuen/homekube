# Workflows Worker (Quarkus Kotlin) — Implementation Spec (Implementation)

> **Migration Note (completed):** The original `web-scraper` (TypeScript) and `news-worker` (TypeScript/Node.js) have been merged into a single service called `workflows-worker` (Kotlin/Quarkus). The directory remains `web-scraper-kt/` but the service name, Docker image, k8s deployment, database, and package have all been renamed. The service uses jOOQ for database access (not Hibernate ORM Panache). This spec has been updated to reflect the current state.

## Context

A Quarkus Kotlin service that consolidates the former TypeScript web-scraper and news-worker into a single `workflows-worker` service. Provides the web scraper REST API, web scraper Temporal workflow, news digest workflow, and economist digest workflow. Integrates with PostgreSQL, Kafka, Keycloak, and Temporal. Calls the `claude-code-api` HTTP service instead of kubectl exec.

---

## 1. Service Overview

| Property | Value |
|----------|-------|
| Language | Kotlin |
| Framework | Quarkus 3.x |
| Build tool | Gradle (Kotlin DSL) |
| Port | 3000 |
| Namespace | `temporal` |
| Service name | `workflows-worker` |
| Image | `localhost:5000/workflows-worker:latest` |
| Temporal task queue | `workflows-worker-queue` |
| Database | PostgreSQL `workflows_worker` (CNPG cluster) |

**Implementation Implication:** The service has been renamed from `web-scraper` to `workflows-worker` to reflect its expanded scope (web scraper + news digest + economist digest). The homepage SvelteKit proxy routes remain unchanged.

---

## 2. File Structure

```
web-scraper-kt/
├── build.gradle.kts
├── settings.gradle.kts
├── gradle.properties
├── Dockerfile
├── build.sh
├── src/
│   └── main/
│       ├── kotlin/
│       │   └── com/homekube/worker/
│       │       ├── App.kt                    # Application entry + Temporal worker startup
│       │       ├── Routes.kt                 # JAX-RS resource (7 REST endpoints)
│       │       ├── Models.kt                 # Data classes (Job, Run, request/response DTOs)
│       │       ├── JobRepository.kt          # jOOQ repository for scrape_jobs
│       │       ├── RunRepository.kt          # jOOQ repository for scrape_runs
│       │       ├── ScheduleManager.kt        # Temporal schedule CRUD
│       │       ├── workflow/
│       │       │   ├── WebScraperWorkflow.kt  # Workflow interface + implementation
│       │       │   └── Activities.kt          # Activity interface
│       │       └── activities/
│       │           ├── LoadJobActivity.kt
│       │           ├── ScrapeUrlsActivity.kt
│       │           ├── AnalyseWithClaudeActivity.kt
│       │           ├── GetJobSubscribersActivity.kt
│       │           ├── SendNotificationActivity.kt
│       │           └── RecordRunActivity.kt
│       └── resources/
│           ├── application.properties         # Quarkus config
│           └── db/migration/
│               └── V1__create_tables.sql      # Flyway migration (same schema)
└── k8s/
    ├── deploy.yaml
    ├── service.yaml
    ├── db.yaml                               # CNPG cluster definition
    └── service-monitor.yaml
```

**Implementation Implication:** Standard Quarkus project layout. Package `com.homekube.worker`. Uses jOOQ for database access. Flyway replaces the custom migration runner. No `serviceaccount.yaml` needed — no kubectl exec.

---

## 3. Dependencies (build.gradle.kts)

```kotlin
plugins {
    kotlin("jvm") version "2.1.0"
    kotlin("plugin.allopen") version "2.1.0"
    id("io.quarkus") version "3.17.0"
}

dependencies {
    // Quarkus core
    implementation("io.quarkus:quarkus-kotlin")
    implementation("io.quarkus:quarkus-rest-jackson")
    implementation("io.quarkus:quarkus-rest")

    // Database
    implementation("io.quarkiverse.jooq:quarkus-jooq")
    implementation("io.quarkus:quarkus-jdbc-postgresql")
    implementation("io.quarkus:quarkus-flyway")

    // Auth (bearer token validation + client credentials for service-to-service calls)
    implementation("io.quarkus:quarkus-oidc")
    implementation("io.quarkus:quarkus-oidc-client")

    // Kafka
    implementation("io.quarkus:quarkus-messaging-kafka")

    // Observability
    implementation("io.quarkus:quarkus-micrometer-registry-prometheus")
    implementation("io.quarkus:quarkus-smallrye-health")

    // Temporal
    implementation("io.temporal:temporal-sdk:1.27.0")

    // HTTP client (for Claude API + WhatsApp calls)
    implementation("io.quarkus:quarkus-rest-client-jackson")

    // Kotlin
    implementation("org.jetbrains.kotlin:kotlin-stdlib")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.9.0")

    // Test
    testImplementation("io.quarkus:quarkus-junit5")
    testImplementation("io.rest-assured:rest-assured")
}
```

**Implementation Implication:** Quarkus extensions handle most infrastructure concerns declaratively (OIDC, health, metrics, Kafka, Flyway). jOOQ provides type-safe SQL queries without the overhead of a full ORM. Temporal SDK is managed via the Quarkiverse Temporal extension. `quarkus-rest-client-jackson` provides the typed HTTP client for calling claude-code-api and WhatsApp services.

---

## 4. Configuration (application.properties)

```properties
# Server
quarkus.http.port=3000

# Database
quarkus.datasource.db-kind=postgresql
quarkus.datasource.jdbc.url=jdbc:postgresql://workflows-worker-db-rw.temporal.svc.cluster.local:5432/workflows_worker
quarkus.datasource.username=${WORKFLOWS_WORKER_DB_USER}
quarkus.datasource.password=${WORKFLOWS_WORKER_DB_PASSWORD}

# Flyway
quarkus.flyway.migrate-at-start=true

# OIDC (Keycloak)
quarkus.oidc.auth-server-url=${KEYCLOAK_URL:http://keycloak.keycloak.svc.cluster.local}/realms/${KEYCLOAK_REALM:homekube}
quarkus.oidc.client-id=workflows-worker
quarkus.oidc.credentials.secret=${KEYCLOAK_CLIENT_SECRET}
quarkus.oidc.token.audience=workflows-worker

# OIDC Client (for service-to-service calls to WhatsApp API)
quarkus.oidc-client.auth-server-url=${KEYCLOAK_URL:http://keycloak.keycloak.svc.cluster.local}/realms/${KEYCLOAK_REALM:homekube}
quarkus.oidc-client.client-id=workflows-worker
quarkus.oidc-client.credentials.secret=${KEYCLOAK_CLIENT_SECRET}
quarkus.oidc-client.grant.type=client_credentials

# Kafka
mp.messaging.outgoing.digests.connector=smallrye-kafka
mp.messaging.outgoing.digests.topic=digests
mp.messaging.outgoing.digests.bootstrap.servers=${KAFKA_BROKERS:tansu.default.svc.cluster.local:9092}
mp.messaging.outgoing.digests.value.serializer=org.apache.kafka.common.serialization.StringSerializer
mp.messaging.outgoing.digests.key.serializer=org.apache.kafka.common.serialization.StringSerializer

# Health
quarkus.smallrye-health.root-path=/health

# Metrics
quarkus.micrometer.export.prometheus.path=/metrics

# Custom properties
app.temporal.address=${TEMPORAL_ADDRESS:temporal-frontend:7233}
app.temporal.task-queue=workflows-worker-queue
app.claude-api.url=${CLAUDE_API_URL:http://claude-code-api.default.svc.cluster.local}
app.whatsapp.url=${WHATSAPP_URL:http://whatsapp.default.svc.cluster.local}
app.max-jobs-per-user=10
```

**Implementation Implication:** Quarkus OIDC extension replaces the entire `auth.ts` (76 LOC -> 4 lines of config). Flyway replaces the custom migration runner. jOOQ replaces Hibernate ORM Panache for type-safe SQL without ORM overhead. SmallRye Kafka replaces the KafkaJS producer singleton. Health and metrics are zero-code extensions.

---

## 5. Database Schema (Flyway Migration)

**File:** `src/main/resources/db/migration/V1__create_tables.sql`

Identical to the existing schema:

```sql
CREATE TABLE IF NOT EXISTS scrape_jobs (
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

CREATE TABLE IF NOT EXISTS scrape_runs (
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

**Implementation Implication:** Use `CREATE TABLE IF NOT EXISTS` because the tables already exist in the shared database. Flyway tracks migration state in its own `flyway_schema_history` table (does not conflict with the TypeScript service's `schema_migrations` table). During migration, both services can coexist reading the same tables.

---

## 6. Data Models (Models.kt)

```kotlin
// Data classes (mapped from jOOQ query results)
data class ScrapeJob(
    val id: UUID = UUID.randomUUID(),
    val userId: String = "",
    val name: String = "",
    val urls: List<String> = emptyList(),
    val instruction: String = "",
    val scheduleCron: String = "0 */3 * * *",
    val timezone: String = "Australia/Sydney",
    val enabled: Boolean = true,
    val createdAt: Instant = Instant.now(),
    val updatedAt: Instant = Instant.now(),
)

data class ScrapeRun(
    val id: UUID = UUID.randomUUID(),
    val jobId: UUID = UUID.randomUUID(),
    val status: String = "running",
    val urlsScraped: Int = 0,
    val notified: Boolean = false,
    val claudeResponse: String? = null,
    val error: String? = null,
    val startedAt: Instant = Instant.now(),
    val completedAt: Instant? = null,
)

// Request/Response DTOs
data class CreateJobRequest(
    val name: String,
    val urls: List<String>,
    val instruction: String,
    val schedule_cron: String? = null,
    val timezone: String? = null,
)

data class UpdateJobRequest(
    val name: String? = null,
    val urls: List<String>? = null,
    val instruction: String? = null,
    val schedule_cron: String? = null,
    val timezone: String? = null,
    val enabled: Boolean? = null,
)

data class JobResponse(val job: ScrapeJob)
data class JobListResponse(val jobs: List<ScrapeJob>)
data class RunListResponse(val runs: List<ScrapeRun>)
data class DeleteResponse(val deleted: Boolean = true)
data class TriggerResponse(val workflowId: String)
```

**Implementation Implication:** Plain Kotlin data classes -- no JPA annotations needed. jOOQ maps query results to these data classes directly. The `urls` field uses jOOQ's PostgreSQL array support to map `text[]` to `List<String>`. JSON serialization uses Jackson (via `quarkus-rest-jackson`), which maps Kotlin data classes automatically.

---

## 7. REST API (Routes.kt)

All 7 endpoints are identical to the current TypeScript implementation. The `@Authenticated` and `@Context SecurityContext` annotations replace the manual JWT middleware.

```kotlin
@Path("/api")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
@Authenticated
class ScraperResource {

    @GET @Path("/jobs")
    fun listJobs(@Context securityContext: SecurityContext): JobListResponse

    @POST @Path("/jobs")
    fun createJob(body: CreateJobRequest, @Context securityContext: SecurityContext): Response

    @GET @Path("/jobs/{id}")
    fun getJob(@PathParam("id") id: UUID, @Context securityContext: SecurityContext): Response

    @PUT @Path("/jobs/{id}")
    fun updateJob(@PathParam("id") id: UUID, body: UpdateJobRequest, @Context securityContext: SecurityContext): Response

    @DELETE @Path("/jobs/{id}")
    fun deleteJob(@PathParam("id") id: UUID, @Context securityContext: SecurityContext): Response

    @POST @Path("/jobs/{id}/trigger")
    fun triggerJob(@PathParam("id") id: UUID, @Context securityContext: SecurityContext): Response

    @GET @Path("/jobs/{id}/runs")
    fun getJobRuns(
        @PathParam("id") id: UUID,
        @QueryParam("limit") @DefaultValue("20") limit: Int,
        @Context securityContext: SecurityContext,
    ): Response
}
```

### Endpoint Behavior (identical to TypeScript)

| Endpoint | Validation | Side Effects | Response Codes |
|----------|-----------|--------------|----------------|
| `GET /api/jobs` | — | — | 200, 500 |
| `POST /api/jobs` | name, urls (non-empty), instruction required; cron validated; max 10 jobs | Create Temporal schedule; update active_jobs gauge | 201, 400, 500 |
| `GET /api/jobs/:id` | — | — | 200, 404 |
| `PUT /api/jobs/:id` | cron validated if provided; urls non-empty if provided | Update/recreate schedule if cron/tz changed; pause/unpause if enabled changed | 200, 400, 404, 500 |
| `DELETE /api/jobs/:id` | — | Delete Temporal schedule; update active_jobs gauge | 200, 404, 500 |
| `POST /api/jobs/:id/trigger` | — | Start workflow `workflows-worker-{id}-manual-{timestamp}` | 200, 404, 500 |
| `GET /api/jobs/:id/runs` | limit: 1-100 | — | 200, 404, 500 |

**Implementation Implication:** User ID extraction: `securityContext.userPrincipal.name` maps to Keycloak's `preferred_username` (same as current behavior). All job queries are filtered by `userId = currentUser`.

### Cron Validation

```kotlin
private val CRON_REGEX = Regex("^([0-9*\\/,\\-]+\\s+){4}[0-9*\\/,\\-]+$")

fun validateCron(cron: String): Boolean = CRON_REGEX.matches(cron.trim())
```

Must have exactly 5 space-separated fields, each containing only `0-9 * / , -`. Same regex as the TypeScript version.

---

## 8. Temporal Workflow (workflow/WebScraperWorkflow.kt)

### Workflow Interface

```kotlin
@WorkflowInterface
interface WebScraperWorkflow {
    @WorkflowMethod
    fun execute(input: WebScraperInput): String
}

data class WebScraperInput(val jobId: String)
```

### Workflow Implementation

Exact same control flow as TypeScript version:

1. `loadJob(jobId)` — fetch job config from DB
2. `scrapeUrls(job.urls)` — fetch and extract text from URLs
3. If 0 URLs scraped → record failure, return early
4. `analyseWithClaude(instruction, scrapedContent)` — HTTP POST to claude-code-api
5. If `shouldNotify` → `getJobSubscribers(userId)` → `sendNotification(...)`
6. `recordRun(...)` — persist result + update metrics
7. On any exception: attempt `recordRun` with failure status, then rethrow

### Activity Interface

```kotlin
@ActivityInterface
interface ScraperActivities {
    fun loadJob(jobId: String): ScrapeJob
    fun scrapeUrls(urls: List<String>): List<ScrapedContent>
    fun analyseWithClaude(input: AnalysisInput): AnalysisResult
    fun getJobSubscribers(userId: String): List<Subscriber>
    fun sendNotification(input: SendNotificationInput)
    fun recordRun(input: RecordRunInput)
}
```

### Activity Timeouts (same as TypeScript)

| Activity | startToCloseTimeout | Retry (maxAttempts) |
|----------|--------------------|--------------------|
| loadJob | 30s | 3 |
| scrapeUrls | 2min | 3 |
| analyseWithClaude | 3min | 3 |
| getJobSubscribers | 30s | 3 |
| sendNotification | 30s | 3 |
| recordRun | 30s | 3 |

---

## 9. Activity Implementations

### 9.1 LoadJobActivity

- Query `scrape_jobs` by ID
- Throw `ApplicationFailure` if not found
- Return `ScrapeJob` data class

### 9.2 ScrapeUrlsActivity

- For each URL: HTTP GET with 30s timeout
- User-Agent: `Mozilla/5.0 (compatible; HomekubeScraper/1.0)`
- Extract text: strip `<script>`, `<style>`, HTML tags, decode entities, collapse whitespace
- Truncate to 5000 chars per URL
- Skip failed URLs (log warning), return successful ones
- Return `List<ScrapedContent>` (may be empty)

**Implementation Implication:** Use `java.net.http.HttpClient` with `Duration.ofSeconds(30)` timeout. The text extraction logic (regex-based HTML stripping) is identical to the TypeScript version. Use Kotlin extension functions for clean string processing.

### 9.3 AnalyseWithClaudeActivity

**This is the key change from the TypeScript version.**

```kotlin
// OLD: kubectl exec -n default <pod> -i -- claude --output-format text -p -
// NEW: HTTP POST to claude-code-api
```

**Prompt Template:**

```text
You are a web monitoring assistant. The user has configured a monitoring job with this instruction:

"{instruction}"

Below is the content scraped from the monitored URLs:

--- URL: {url} ---
{text}

(repeated for each URL, text truncated to 5000 chars)

Analyze the scraped content against the user's instruction. Respond in this exact JSON format:
{"shouldNotify": true/false, "message": "WhatsApp message if notifying, or brief status if not"}

Rules:
- Set shouldNotify to true ONLY if the content matches what the user asked to be alerted about
- If notifying, write a concise WhatsApp-friendly message using *bold* for emphasis
- If not notifying, set message to a brief status like "No matching content found"
- Do not hallucinate or invent information not present in the scraped content
```

**Process:**
1. Build prompt string using the template above
2. HTTP POST to `${CLAUDE_API_URL}/api/analyze` with:
   ```json
   {
     "prompt": "<constructed prompt>",
     "output_format": "text",
     "timeout_seconds": 120
   }
   ```
3. Parse response body's `response` field
4. Extract JSON from response text (regex: `/\{[\s\S]*"shouldNotify"[\s\S]*\}/`)
5. If no JSON found: return `AnalysisResult(shouldNotify = false, message = "Parse error: no JSON")`
6. Parse JSON, return `AnalysisResult(shouldNotify, message)`

**Implementation Implication:** Use Quarkus REST client (`@RegisterRestClient`) for typed HTTP calls. The prompt template and JSON parsing logic are identical to the TypeScript version. The only change is the transport: HTTP POST instead of kubectl exec + stdin pipe.

### 9.4 GetJobSubscribersActivity

- Obtain service token from Keycloak (client_credentials grant)
- POST to `${WHATSAPP_URL}/api/sessions/lookup` with `{ userIds: [userId] }`
- Return list of `Subscriber(userId, phone)`

**Implementation Implication:** Use Quarkus OIDC client (`quarkus-oidc-client` extension) for the client_credentials token. This replaces the manual token fetch in the TypeScript version.

### 9.5 SendNotificationActivity

- For each subscriber: produce to Kafka `digests` topic
- Message key: `subscriber.userId`
- Message value: `{ userId, recipientPhone, message, workflow, timestamp }`
- Increment `scraper_notifications_sent_total` counter
- Collect failures, throw if any subscriber fails

**Implementation Implication:** Use SmallRye Reactive Messaging `@Channel("digests") Emitter<String>` for Kafka production. Message format is identical to the TypeScript version.

### 9.6 RecordRunActivity

- Insert row into `scrape_runs` table
- Update Prometheus counters: `scraper_runs_total`, `scraper_run_duration_seconds`, `scraper_urls_scraped_total`

---

## 10. Schedule Management (ScheduleManager.kt)

Uses Temporal Java SDK `ScheduleClient`:

| Operation | Temporal SDK Call | Trigger |
|-----------|------------------|---------|
| Create | `scheduleClient.createSchedule(id, schedule)` | POST /api/jobs |
| Delete | `scheduleHandle.delete()` | DELETE /api/jobs/:id |
| Update | Delete + Create | PUT /api/jobs/:id (cron/tz changed) |
| Pause | `scheduleHandle.pause("Job disabled")` | PUT /api/jobs/:id (enabled=false) |
| Unpause | `scheduleHandle.unpause("Job enabled")` | PUT /api/jobs/:id (enabled=true) |

**Schedule ID convention:** `workflows-worker-{jobId}`

**Overlap policy:** `SKIP` (same as TypeScript)

**Implementation Implication:** The Temporal Java SDK `ScheduleClient` API differs from the TypeScript client. Key classes: `ScheduleClient`, `ScheduleHandle`, `Schedule`, `ScheduleSpec`, `ScheduleAction`. The `ScheduleSpec` uses `setCronExpressions(listOf(cron))` and `setTimeZone(timezone)`. Error handling: catch `StatusRuntimeException` for gRPC errors (NOT_FOUND = schedule doesn't exist).

---

## 11. Temporal Worker Startup (App.kt)

```kotlin
@ApplicationScoped
class TemporalWorkerLifecycle(
    private val activities: ScraperActivitiesImpl,
) {
    private lateinit var factory: WorkerFactory

    fun onStart(@Observes StartupEvent event) {
        val connection = WorkflowServiceStubs.newServiceStubs(
            WorkflowServiceStubsOptions.newBuilder()
                .setTarget(temporalAddress)
                .build()
        )
        val client = WorkflowClient.newInstance(connection)
        factory = WorkerFactory.newInstance(client)

        val worker = factory.newWorker("workflows-worker-queue")
        worker.registerWorkflowImplementationTypes(WebScraperWorkflowImpl::class.java)
        worker.registerActivitiesImplementations(activities)
        factory.start()
    }

    fun onStop(@Observes ShutdownEvent event) {
        factory.shutdown()
    }
}
```

**Implementation Implication:** Quarkus CDI lifecycle events (`@Observes StartupEvent/ShutdownEvent`) replace the manual server startup in `index.ts`. The worker runs in the same process as the REST API (same as TypeScript). Activity implementations are CDI beans injected into the worker.

---

## 12. Prometheus Metrics

Same metric names and labels as the TypeScript version:

| Metric | Type | Labels |
|--------|------|--------|
| `http_requests_total` | Counter | method, path, status |
| `http_request_duration_seconds` | Histogram | method, path, status |
| `scraper_runs_total` | Counter | job_name, status |
| `scraper_run_duration_seconds` | Histogram | job_name |
| `scraper_urls_scraped_total` | Counter | job_name |
| `scraper_notifications_sent_total` | Counter | job_name |
| `scraper_active_jobs` | Gauge | — |

**Implementation Implication:** HTTP metrics are provided automatically by `quarkus-micrometer`. Application metrics use `MeterRegistry` injection:

```kotlin
@ApplicationScoped
class MetricsService(@Inject val registry: MeterRegistry) {
    fun recordRun(jobName: String, status: String, durationMs: Long) {
        registry.counter("scraper_runs_total", "job_name", jobName, "status", status).increment()
        registry.timer("scraper_run_duration_seconds", "job_name", jobName)
            .record(Duration.ofMillis(durationMs))
    }
}
```

---

## 13. Dockerfile

```dockerfile
# Stage 1: Build (fast-jar packaging — Quarkus default)
FROM gradle:8.12-jdk21 AS builder
WORKDIR /app
COPY build.gradle.kts settings.gradle.kts gradle.properties ./
COPY src/ src/
RUN gradle build -x test

# Stage 2: Runtime
FROM eclipse-temurin:21-jre-alpine
WORKDIR /app
COPY --from=builder /app/build/quarkus-app/ ./
EXPOSE 3000
CMD ["java", "-jar", "quarkus-run.jar"]
```

**Implementation Implication:** Uses JDK 21 (LTS). Quarkus fast-jar packaging (default) — produces `build/quarkus-app/` directory with `quarkus-run.jar` entrypoint. No kubectl needed in the image (major improvement). Alpine JRE base keeps image small (~200MB).

---

## 14. Kubernetes Manifests

### deploy.yaml

Same structure as current TypeScript deployment, minus the ServiceAccount:

```yaml
env:
- name: TEMPORAL_ADDRESS
  value: "temporal-frontend:7233"
- name: KEYCLOAK_URL
  value: "http://keycloak.keycloak.svc.cluster.local"
- name: KEYCLOAK_REALM
  value: "homekube"
- name: KEYCLOAK_CLIENT_SECRET
  valueFrom:
    secretKeyRef:
      name: workflows-worker-keycloak
      key: client-secret
      optional: true
- name: WORKFLOWS_WORKER_DB_USER
  valueFrom:
    secretKeyRef:
      name: workflows-worker-db-app
      key: username
- name: WORKFLOWS_WORKER_DB_PASSWORD
  valueFrom:
    secretKeyRef:
      name: workflows-worker-db-app
      key: password
- name: WHATSAPP_URL
  value: "http://whatsapp.default.svc.cluster.local"
- name: KAFKA_BROKERS
  value: "tansu.default.svc.cluster.local:9092"
- name: CLAUDE_API_URL
  value: "http://claude-code-api.default.svc.cluster.local"
```

**Changes from TypeScript deployment:**
- Removed: `CLAUDE_CODE_NAMESPACE`, `CLAUDE_CODE_LABEL` (no kubectl exec)
- Added: `CLAUDE_API_URL` (new HTTP service)
- Removed: `serviceAccountName: web-scraper` (no RBAC needed)
- Resources: request 256Mi → 512Mi RAM (JVM), limit 512Mi → 1Gi RAM

### service.yaml, db.yaml, service-monitor.yaml

Identical to current TypeScript versions. No changes needed.

### Removed: serviceaccount.yaml

No longer needed. The Quarkus service does not kubectl exec into any pods.

---

## 15. Environment Variables

| Variable | Default | Required | Description |
|----------|---------|----------|-------------|
| `TEMPORAL_ADDRESS` | `temporal-frontend:7233` | no | Temporal server address |
| `KEYCLOAK_URL` | `http://keycloak.keycloak.svc.cluster.local` | no | Keycloak base URL |
| `KEYCLOAK_REALM` | `homekube` | no | Keycloak realm |
| `KEYCLOAK_CLIENT_SECRET` | — | yes | OIDC client secret |
| `WORKFLOWS_WORKER_DB_USER` | — | yes | PostgreSQL username |
| `WORKFLOWS_WORKER_DB_PASSWORD` | — | yes | PostgreSQL password |
| `WHATSAPP_URL` | `http://whatsapp.default.svc.cluster.local` | no | WhatsApp service URL |
| `KAFKA_BROKERS` | `tansu.default.svc.cluster.local:9092` | no | Kafka bootstrap servers |
| `CLAUDE_API_URL` | `http://claude-code-api.default.svc.cluster.local` | no | Claude Code API URL |

---

## 16. Anti-Patterns (DO NOT)

| Don't | Do Instead | Why |
|-------|-----------|-----|
| Use Spring Boot | Use Quarkus | Quarkus is chosen for fast startup, native-image readiness, and built-in extensions |
| Use Java instead of Kotlin | Use Kotlin throughout | Kotlin reduces boilerplate, null safety, data classes, coroutines |
| Use `@Blocking` on REST endpoints | Use `@RunOnVirtualThread` for endpoints that call blocking Temporal SDK | RESTEasy Reactive uses event-loop by default; `@RunOnVirtualThread` (JDK 21) avoids blocking the event loop without needing reactive patterns |
| Use Hibernate ORM / Panache | Use jOOQ for type-safe SQL | jOOQ provides direct SQL control without ORM overhead, better for PostgreSQL-specific features like arrays |
| Create a custom migration system | Use Flyway (Quarkus extension) | Flyway is battle-tested and Quarkus-integrated |
| Manually validate JWT tokens | Use `quarkus-oidc` extension | Declarative auth via `@Authenticated` and `application.properties` |
| Use KafkaProducer directly | Use SmallRye Reactive Messaging `Emitter` | Declarative config, auto-connection management |
| Copy the kubectl exec pattern | Call claude-code-api via HTTP | The entire point of this rewrite |
| Store scraped content in DB | Only store Claude's response + decision | Content can be huge, DB bloat |
| Run scraping in REST request handler | Always run via Temporal workflow | Timeouts, retries, observability |
| Parse Claude JSON without try/catch | Always wrap in try/catch, default to no-notify | Claude may return malformed JSON |
| Use `fetch` (JS) for URL scraping | Use `java.net.http.HttpClient` with 30s timeout | JVM HTTP client, no external dependency |
| Trust user cron expressions blindly | Validate cron syntax (regex) before saving | Invalid cron crashes Temporal schedule creation |
| Create a new Kafka topic | Reuse existing `digests` topic | WhatsApp consumer already listens on it |
| Use blocking Temporal client calls in activities | Activities run on Temporal worker threads (blocking is fine) | Temporal activities ARE blocking by design |
| Add serviceaccount/RBAC manifests | Remove them entirely | No kubectl exec needed |

---

## 17. Test Case Specifications

### Unit Tests

| Test ID | Component | Input | Expected Output | Edge Cases |
|---------|-----------|-------|-----------------|------------|
| TC-001 | scrapeUrls | 3 valid URLs | 3 content items with text ≤5000 chars | Empty HTML, HTTP 404, timeout, connection refused |
| TC-002 | analyseWithClaude | Content + instruction | AnalysisResult with shouldNotify + message | Claude API timeout (408), Claude API error (502), non-JSON response |
| TC-003 | POST /api/jobs | Valid CreateJobRequest | 201 + job JSON | Missing name (400), empty urls (400), invalid cron (400), 11th job (400) |
| TC-004 | PUT /api/jobs/:id | Partial UpdateJobRequest | 200 + updated job | Non-owner (404), nonexistent id (404), invalid cron (400) |
| TC-005 | DELETE /api/jobs/:id | Valid UUID | 200 + `{deleted: true}` | Non-owner (404), nonexistent (404) |
| TC-006 | GET /api/jobs/:id/runs | Valid job UUID, limit=5 | 200 + ≤5 runs sorted DESC | No runs (empty array), limit=0 (default 20), limit=200 (cap at 100) |
| TC-007 | ScheduleManager.create | jobId, cron, timezone | Schedule created in Temporal | Schedule already exists |
| TC-008 | ScheduleManager.delete | jobId | Schedule deleted | Schedule doesn't exist (no error) |
| TC-009 | Cron validation | "0 */3 * * *" | true | "every 3 hours" (false), "" (false), "0 * * * * *" (false — 6 fields) |
| TC-010 | HTML text extraction | `<p>Hello <b>world</b></p>` | "Hello world" | Script tags, style tags, entities, Unicode |

### Integration Tests

| Test ID | Flow | Setup | Verification | Teardown |
|---------|------|-------|--------------|----------|
| IT-001 | Full workflow | Create job in DB, mock Claude API | Workflow runs all 6 activities, records run | Delete job |
| IT-002 | Notification path | Job + Claude returns shouldNotify: true | Kafka message produced on `digests` topic | Delete job |
| IT-003 | No-notification path | Job + Claude returns shouldNotify: false | No Kafka message, run recorded as success | Delete job |
| IT-004 | REST API CRUD | — | Create → Get → Update → List → Delete lifecycle | — |
| IT-005 | Schedule lifecycle | Create job | Temporal schedule exists, pause/unpause works | Delete job + schedule |

---

## 18. Error Handling Matrix

| Error Type | Detection | Response | Fallback | Logging |
|------------|-----------|----------|----------|---------|
| URL fetch fails (4xx/5xx) | HTTP status check | Skip URL, continue | Return partial results | WARN |
| URL fetch timeout (>30s) | HttpTimeoutException | Skip URL, continue | Return partial results | WARN |
| All URLs fail to scrape | Empty scrapedContent list | Record failure run, return early | — | ERROR |
| Claude API unreachable | Connection refused / timeout | Throw, Temporal retries | — | ERROR |
| Claude API returns 408 (timeout) | HTTP 408 status | Throw, Temporal retries | — | ERROR |
| Claude API returns 502 (Claude error) | HTTP 502 status | Throw, Temporal retries | — | ERROR |
| Claude response has no JSON | Regex match fails | `AnalysisResult(shouldNotify=false, message="Parse error")` | Log response snippet | WARN |
| Kafka produce fails | SmallRye exception | Throw, Temporal retries | — | ERROR |
| WhatsApp session not found | Empty subscriber list | Skip notification, record success | — | INFO |
| Invalid cron in REST API | Regex validation fails | 400 + error message | — | WARN |
| Job not found | DB query returns null | 404 (REST) or throw (workflow) | — | WARN |
| Temporal schedule not found | gRPC NOT_FOUND status | Ignore (idempotent delete) | — | INFO |
| DB connection failure | SQLException | 500 (REST) or throw (activity) | Temporal retries activities | ERROR |
| Keycloak token fetch fails | HTTP error | Throw, Temporal retries | — | ERROR |
| User exceeds 10-job limit | Count query | 400 + error message | — | WARN |

---

## 19. References

| Topic | Location |
|-------|----------|
| Strategic blueprint | [00-strategic-blueprint.md](./00-strategic-blueprint.md) |
| Claude Code API spec | [01-claude-code-api-spec.md](./01-claude-code-api-spec.md) |
| Current web-scraper spec | [web-scraper/docs/spec.md](../../web-scraper/docs/spec.md) |
| Current web-scraper source | `web-scraper/src/` (all files) |
| Temporal Java SDK docs | https://docs.temporal.io/develop/java |
| Quarkus OIDC guide | https://quarkus.io/guides/security-oidc-bearer-token-authentication |
| Quarkus Kafka guide | https://quarkus.io/guides/kafka |
| jOOQ Quarkiverse extension | https://docs.quarkiverse.io/quarkus-jooq/dev/index.html |
| Quarkus Flyway guide | https://quarkus.io/guides/flyway |
| Quarkus Micrometer guide | https://quarkus.io/guides/micrometer |
| Existing Kafka topic schema | `{ userId, recipientPhone, message, workflow, timestamp }` on `digests` topic |
| WhatsApp session lookup API | `POST /api/sessions/lookup` with `{ userIds: [userId] }` |
| Homepage proxy routes | `homepage/src/routes/api/scraper/` (unchanged) |
