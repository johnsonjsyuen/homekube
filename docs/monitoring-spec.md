# Homekube Monitoring Implementation Spec (Implementation)

## 1. Helm Chart Configuration

Install `kube-prometheus-stack` in a dedicated `monitoring` namespace with homelab-appropriate resource limits.

### Namespace

```bash
kubectl create namespace monitoring
```

### Helm Install

```bash
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm repo update

helm install kube-prometheus-stack prometheus-community/kube-prometheus-stack \
  --namespace monitoring \
  --values monitoring-values.yaml
```

### Values File

```yaml
# monitoring-values.yaml

# -- Prometheus Operator: watch all namespaces for ServiceMonitors/PodMonitors
prometheus:
  prometheusSpec:
    serviceMonitorSelectorNilUsesHelmValues: false
    serviceMonitorNamespaceSelector: {}
    podMonitorSelectorNilUsesHelmValues: false
    podMonitorNamespaceSelector: {}
    retention: 15d
    storageSpec:
      volumeClaimTemplate:
        spec:
          accessModes: ["ReadWriteOnce"]
          resources:
            requests:
              storage: 20Gi
    resources:
      requests:
        memory: 512Mi
        cpu: 250m
      limits:
        memory: 2Gi

# -- Grafana
grafana:
  persistence:
    enabled: true
    size: 5Gi
  grafana.ini:
    server:
      root_url: "%(protocol)s://%(domain)s/grafana"
      serve_from_sub_path: true

# -- Disable AlertManager (not needed for homelab MVP)
alertmanager:
  enabled: false

# -- Disable components that don't exist in k3s
kubeEtcd:
  enabled: false
kubeScheduler:
  enabled: false
kubeControllerManager:
  enabled: false
kubeProxy:
  enabled: false
```

### Configuration Notes

| Setting | Value | Rationale |
|---------|-------|-----------|
| `serviceMonitorNamespaceSelector: {}` | Match all namespaces | Services live in `default` and `temporal`; Prometheus must watch both |
| `podMonitorNamespaceSelector: {}` | Match all namespaces | CNPG PodMonitors are in `default`, `temporal`, `keycloak` |
| `retention: 15d` | 15-day retention | Sufficient for homelab trend analysis without large storage |
| `storage: 20Gi` | Prometheus PVC | Accommodates 15 days of metrics from ~10 scrape targets |
| `memory: 512Mi-2Gi` | Prometheus RAM | Floor for startup, ceiling for cardinality growth |
| `alertmanager.enabled: false` | Disabled | No alerting infrastructure needed yet |
| `kubeEtcd/Scheduler/Controller/Proxy: false` | Disabled | k3s bundles these internally; endpoints are not exposed |
| `serve_from_sub_path: true` | Grafana subpath | Serve Grafana at `/grafana` behind the existing ingress |

## 2. Rust Service Instrumentation (TTS + STT)

Both Rust services use axum. The `axum-prometheus` crate provides automatic HTTP request metrics (duration histograms, request counts by method/status/path). The `metrics` crate provides the API for custom business metrics.

### Dependencies

Add to both `text-to-speech/Cargo.toml` and `speech-to-text/Cargo.toml`:

```toml
axum-prometheus = "0.7"
metrics = "0.23"
```

### Pattern: axum-prometheus Setup

```rust
use axum_prometheus::PrometheusMetricLayer;

// In main():
let (prometheus_layer, metric_handle) = PrometheusMetricLayer::pair();

let app = Router::new()
    .route("/metrics", get(|| async move { metric_handle.render() }))
    // ... existing routes ...
    .layer(prometheus_layer);
```

The `/metrics` route is placed outside the auth middleware so Prometheus can scrape it without a JWT.

### TTS Custom Metrics

Add to `text-to-speech/src/handlers.rs` (or a new `text-to-speech/src/metrics.rs` module):

```rust
use metrics::{counter, gauge, histogram};

// In generate_speech handler:
counter!("tts_jobs_total", "status" => "submitted").increment(1);

// On job completion (success):
counter!("tts_jobs_total", "status" => "completed").increment(1);
histogram!("tts_generation_duration_seconds").record(duration.as_secs_f64());

// On job failure:
counter!("tts_jobs_total", "status" => "failed").increment(1);

// Track active jobs (increment on start, decrement on finish):
gauge!("tts_active_jobs").increment(1.0);
// ... after job completes:
gauge!("tts_active_jobs").decrement(1.0);
```

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `tts_jobs_total` | Counter | `status` (submitted, completed, failed) | Total TTS generation jobs |
| `tts_generation_duration_seconds` | Histogram | -- | Time to generate audio from text |
| `tts_active_jobs` | Gauge | -- | Currently in-progress TTS jobs |

### STT Custom Metrics

Add to `speech-to-text/src/transcribe.rs` (or a new `speech-to-text/src/metrics.rs` module):

```rust
use metrics::{counter, gauge, histogram};

// On WebSocket session start:
counter!("stt_transcriptions_total").increment(1);
gauge!("stt_active_sessions").increment(1.0);

// On each audio segment processed:
counter!("stt_audio_segments_total").increment(1);

// On transcription complete:
histogram!("stt_transcription_duration_seconds").record(duration.as_secs_f64());
gauge!("stt_active_sessions").decrement(1.0);
```

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `stt_transcriptions_total` | Counter | -- | Total transcription sessions started |
| `stt_transcription_duration_seconds` | Histogram | -- | Duration of a full transcription session |
| `stt_active_sessions` | Gauge | -- | Currently active WebSocket transcription sessions |
| `stt_audio_segments_total` | Counter | -- | Total audio segments received for processing |

### TTS main.rs Changes

```rust
// text-to-speech/src/main.rs -- updated sections only

use axum_prometheus::PrometheusMetricLayer;

// In main(), before building the router:
let (prometheus_layer, metric_handle) = PrometheusMetricLayer::pair();

// Add /metrics route (no auth) and apply the layer:
let app = Router::new()
    .route("/metrics", get(|| async move { metric_handle.render() }))
    .merge(authed_routes)
    .merge(ws_routes)
    .layer(prometheus_layer)
    .with_state(state);
```

### STT main.rs Changes

```rust
// speech-to-text/src/main.rs -- updated sections only

use axum_prometheus::PrometheusMetricLayer;

// In main(), before building the router:
let (prometheus_layer, metric_handle) = PrometheusMetricLayer::pair();

// Add /metrics route (no auth) and apply the layer:
let app = Router::new()
    .route("/transcribe", get(transcribe::ws_handler))
    .route("/health", get(health_check))
    .route("/metrics", get(|| async move { metric_handle.render() }))
    .layer(cors)
    .layer(prometheus_layer)
    .with_state(state);
```

## 3. Node.js Service Instrumentation (WhatsApp) + Kotlin/Quarkus (workflows-worker)

> **Note:** The `news-worker` (TypeScript/Node.js) has been merged into `workflows-worker` (Kotlin/Quarkus). The WhatsApp service remains Node.js/Express and uses `prom-client`. The `workflows-worker` uses Quarkus Micrometer for metrics (see Section 12 of the [Workflows Worker spec](rewrite/02-web-scraper-rewrite-spec.md)).

The WhatsApp Node.js service uses Express. The `prom-client` library provides default process metrics (GC, event loop lag, memory) and an API for custom metrics.

### Dependency

Add to `whatsapp/package.json` (workflows-worker uses Quarkus Micrometer instead):

```json
"prom-client": "^15.1.3"
```

### Pattern: Express Metrics Middleware

Create a shared metrics setup module in each service:

```typescript
// src/metrics.ts
import { Registry, collectDefaultMetrics, Counter, Histogram, Gauge } from 'prom-client';

export const registry = new Registry();
collectDefaultMetrics({ register: registry });

// HTTP request metrics (applied as Express middleware)
const httpRequestDuration = new Histogram({
    name: 'http_request_duration_seconds',
    help: 'Duration of HTTP requests in seconds',
    labelNames: ['method', 'route', 'status_code'],
    registers: [registry],
});

export function metricsMiddleware(req: any, res: any, next: any) {
    const end = httpRequestDuration.startTimer();
    res.on('finish', () => {
        // Normalize route to avoid high cardinality (use route pattern, not params)
        const route = req.route?.path || req.path;
        end({ method: req.method, route, status_code: res.statusCode });
    });
    next();
}
```

### Metrics Endpoint

Add to each service's Express app, before auth middleware:

```typescript
import { registry, metricsMiddleware } from './metrics.js';

// Metrics endpoint (no auth -- Prometheus scrapes this)
app.get('/metrics', async (_req, res) => {
    res.set('Content-Type', registry.contentType);
    res.end(await registry.metrics());
});

// HTTP request duration tracking
app.use(metricsMiddleware);
```

### WhatsApp Custom Metrics

Define in `whatsapp/src/metrics.ts`:

```typescript
import { Counter, Gauge } from 'prom-client';
import { registry } from './metrics.js';

export const whatsappMessagesSent = new Counter({
    name: 'whatsapp_messages_sent_total',
    help: 'Total WhatsApp messages sent',
    registers: [registry],
});

export const whatsappMessagesReceived = new Counter({
    name: 'whatsapp_messages_received_total',
    help: 'Total WhatsApp messages received',
    registers: [registry],
});

export const whatsappActiveSessions = new Gauge({
    name: 'whatsapp_active_sessions',
    help: 'Currently active WhatsApp sessions',
    registers: [registry],
});

export const whatsappSessionConnects = new Counter({
    name: 'whatsapp_session_connects_total',
    help: 'Total WhatsApp session connect events',
    registers: [registry],
});
```

| Metric | Type | Description |
|--------|------|-------------|
| `whatsapp_messages_sent_total` | Counter | Messages sent via `/api/send` |
| `whatsapp_messages_received_total` | Counter | Messages received from WhatsApp Web |
| `whatsapp_active_sessions` | Gauge | Currently connected WhatsApp sessions |
| `whatsapp_session_connects_total` | Counter | Total session connect events (includes reconnects) |

Increment these in the relevant handlers:
- `whatsappMessagesSent.inc()` in the `/api/send` route handler
- `whatsappMessagesReceived.inc()` in the WebSocket message handler
- `whatsappActiveSessions.inc()` / `.dec()` in session connect/disconnect callbacks
- `whatsappSessionConnects.inc()` in session connect callback

### workflows-worker Custom Metrics

> **Note:** These metrics are now implemented in `workflows-worker` (Kotlin/Quarkus) using Micrometer. The TypeScript `prom-client` code below is retained for reference. See Section 12 of the [Workflows Worker spec](rewrite/02-web-scraper-rewrite-spec.md) for the Kotlin implementation.

Originally defined in `news-worker/src/metrics.ts`:

```typescript
import { Counter, Histogram } from 'prom-client';
import { registry } from './metrics.js';

export const workflowRuns = new Counter({
    name: 'workflow_runs_total',
    help: 'Total workflow executions',
    labelNames: ['workflow', 'status'],
    registers: [registry],
});

export const workflowDuration = new Histogram({
    name: 'workflow_duration_seconds',
    help: 'Duration of workflow executions',
    labelNames: ['workflow'],
    registers: [registry],
});

export const workflowArticlesFetched = new Counter({
    name: 'workflow_articles_fetched_total',
    help: 'Total articles fetched across all workflow runs',
    labelNames: ['workflow'],
    registers: [registry],
});

export const workflowMessagesSent = new Counter({
    name: 'workflow_messages_sent_total',
    help: 'Total messages sent by workflows',
    labelNames: ['workflow'],
    registers: [registry],
});
```

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `workflow_runs_total` | Counter | `workflow`, `status` | Workflow executions (success/failure) |
| `workflow_duration_seconds` | Histogram | `workflow` | Workflow wall-clock duration |
| `workflow_articles_fetched_total` | Counter | `workflow` | Articles fetched per workflow run |
| `workflow_messages_sent_total` | Counter | `workflow` | Messages delivered per workflow run |

### Critical Constraint: Temporal Sandbox

**All metrics calls MUST happen inside activity functions, NOT inside workflow functions.**

Temporal workflows run in a deterministic sandbox that forbids non-deterministic operations (network I/O, timers, global state). In the Kotlin/Quarkus `workflows-worker`, this means Micrometer `MeterRegistry` calls must only occur in activity implementations, not in workflow classes. The same principle applied to the former TypeScript `news-worker` with `prom-client`.

```typescript
// WRONG -- will fail in Temporal sandbox
// news-worker/src/workflow.ts
import { workflowRuns } from './metrics.js'; // sandbox violation

export async function DailyNewsDigestWorkflow() {
    workflowRuns.inc(); // will throw
}

// CORRECT -- metrics in activities
// news-worker/src/activities/sendDigest.ts
import { workflowMessagesSent } from '../metrics.js';

export async function sendDigest(phoneNumber: string, message: string) {
    await sendWhatsAppMessage(phoneNumber, message);
    workflowMessagesSent.labels({ workflow: 'news-digest' }).inc();
}
```

Increment counters at the activity level:
- `workflowRuns` in a wrapper activity or in the first/last activity of each workflow
- `workflowDuration` using a timer started in the first activity and recorded in the last
- `workflowArticlesFetched` in the `fetchRssHeadlines` / `scrapeArticles` activities
- `workflowMessagesSent` in the `sendDigest` activity

## 4. Kubernetes Manifests

### Service Updates

Each Service manifest needs two changes for ServiceMonitor discovery:

1. Add `labels.app` to metadata (for ServiceMonitor `selector.matchLabels`)
2. Add `name: http` to the port (for ServiceMonitor `endpoints[].port`)

Example for TTS (same pattern for all four services):

```yaml
# text-to-speech/k8s/service.yaml
apiVersion: v1
kind: Service
metadata:
  name: text-to-speech
  namespace: default
  labels:
    app: text-to-speech    # ADD: label for ServiceMonitor selector
spec:
  selector:
    app: text-to-speech
  ports:
  - name: http             # ADD: named port for ServiceMonitor endpoint
    protocol: TCP
    port: 80
    targetPort: 3000
```

Apply the same changes to:

| Service | File | Namespace |
|---------|------|-----------|
| text-to-speech | `text-to-speech/k8s/service.yaml` | `default` |
| speech-to-text | `speech-to-text/k8s/service.yaml` | `default` |
| whatsapp | `whatsapp/k8s/service.yaml` | `default` |
| workflows-worker | `web-scraper-kt/k8s/service.yaml` | `temporal` |

### ServiceMonitor CRDs

One ServiceMonitor per service, deployed in the same namespace as the service.

#### TTS ServiceMonitor

```yaml
# text-to-speech/k8s/service-monitor.yaml
apiVersion: monitoring.coreos.com/v1
kind: ServiceMonitor
metadata:
  name: text-to-speech
  namespace: default
  labels:
    app: text-to-speech
spec:
  selector:
    matchLabels:
      app: text-to-speech
  endpoints:
  - port: http
    path: /metrics
    interval: 30s
```

#### STT ServiceMonitor

```yaml
# speech-to-text/k8s/service-monitor.yaml
apiVersion: monitoring.coreos.com/v1
kind: ServiceMonitor
metadata:
  name: speech-to-text
  namespace: default
  labels:
    app: speech-to-text
spec:
  selector:
    matchLabels:
      app: speech-to-text
  endpoints:
  - port: http
    path: /metrics
    interval: 30s
```

#### WhatsApp ServiceMonitor

```yaml
# whatsapp/k8s/service-monitor.yaml
apiVersion: monitoring.coreos.com/v1
kind: ServiceMonitor
metadata:
  name: whatsapp
  namespace: default
  labels:
    app: whatsapp
spec:
  selector:
    matchLabels:
      app: whatsapp
  endpoints:
  - port: http
    path: /metrics
    interval: 30s
```

#### workflows-worker ServiceMonitor

```yaml
# web-scraper-kt/k8s/service-monitor.yaml
apiVersion: monitoring.coreos.com/v1
kind: ServiceMonitor
metadata:
  name: workflows-worker
  namespace: temporal
  labels:
    app: workflows-worker
spec:
  selector:
    matchLabels:
      app: workflows-worker
  endpoints:
  - port: http
    path: /metrics
    interval: 30s
```

### CNPG PodMonitors

No new manifests needed. All six CNPG clusters already have `monitoring.enablePodMonitor: true`:

| Cluster | Namespace | Config File |
|---------|-----------|-------------|
| `text-to-speech-db` | `default` | `text-to-speech/k8s/db.yaml` |
| `whatsapp-db` | `default` | `whatsapp/k8s/db.yaml` |
| `keycloak-db` | `keycloak` | `keycloak/k8s/db.yaml` |
| `tansu-db` | `default` | `tansu/k8s/db.yaml` |
| `speedtest-db` | `default` | `speedtest/k8s/postgres-cluster.yaml` |
| `temporal-db` | `temporal` | `temporal/k8s/db.yaml` |

When the Prometheus Operator is installed, the CNPG operator automatically creates PodMonitor resources for these clusters. The `podMonitorNamespaceSelector: {}` Helm value ensures Prometheus discovers them across all namespaces.

## 5. Verification Checklist

### Prometheus Stack Health

```bash
# All pods running in monitoring namespace
kubectl get pods -n monitoring

# Expected: prometheus-kube-prometheus-stack-prometheus-0, grafana, node-exporter (per node),
#           kube-state-metrics, prometheus-operator
```

### Service Metrics Endpoints

```bash
# Port-forward each service and verify /metrics returns Prometheus text
kubectl port-forward svc/text-to-speech 3001:80 -n default &
curl -s localhost:3001/metrics | head -20

kubectl port-forward svc/speech-to-text 3002:80 -n default &
curl -s localhost:3002/metrics | head -20

kubectl port-forward svc/whatsapp 3003:80 -n default &
curl -s localhost:3003/metrics | head -20

kubectl port-forward svc/workflows-worker 3004:80 -n temporal &
curl -s localhost:3004/metrics | head -20
```

### Prometheus Targets

```bash
# Port-forward Prometheus UI
kubectl port-forward svc/kube-prometheus-stack-prometheus 9090:9090 -n monitoring

# Open http://localhost:9090/targets -- all custom services and CNPG should show UP
```

### Grafana Dashboards

```bash
# Port-forward Grafana
kubectl port-forward svc/kube-prometheus-stack-grafana 3000:80 -n monitoring

# Open http://localhost:3000/grafana
# Default credentials: admin / prom-operator
# Verify: Node Exporter dashboard, Kubernetes / Compute Resources dashboards
```

### Custom Metrics Spot Check

```promql
# In Prometheus UI (http://localhost:9090/graph):

# TTS jobs submitted
tts_jobs_total

# STT active sessions
stt_active_sessions

# WhatsApp messages sent
whatsapp_messages_sent_total

# Workflow runs
workflow_runs_total
```

## 6. Anti-patterns

### Do Not Put Metrics Calls in Temporal Workflow Code

Temporal workflows execute inside a deterministic sandbox. Any metrics call (whether `prom-client` in TypeScript or Micrometer in Kotlin) inside a workflow function will cause a non-determinism error. All metric instrumentation must live in activity functions, which run outside the sandbox.

### Do Not Create ServiceMonitors in the monitoring Namespace

ServiceMonitors should be deployed in the same namespace as the service they monitor. This keeps monitoring config co-located with the service manifests and avoids cross-namespace selector confusion. The `serviceMonitorNamespaceSelector: {}` Helm value tells Prometheus to discover ServiceMonitors in all namespaces.

### Do Not Use High-Cardinality Labels

Avoid labels that produce unbounded cardinality:
- **Do not** use full request paths as labels (e.g., `/status/550e8400-e29b-41d4-a716-446655440000`). Use route patterns instead (e.g., `/status/:id`).
- **Do not** add user IDs, session IDs, or job IDs as metric labels. These create a new time series per unique value and will exhaust Prometheus memory.
- `axum-prometheus` handles path normalization automatically for axum routes. For Express, use `req.route?.path` (the route pattern) rather than `req.path` (the actual URL).

### Do Not Set Prometheus Resources Too Low

The 512 MiB request is appropriate for startup, but Prometheus memory usage grows with the number of active time series. The 2 GiB limit provides headroom. If metrics cardinality grows (more services, more label combinations), monitor Prometheus's own `process_resident_memory_bytes` and adjust accordingly.

## REFERENCES

| Topic | Location |
|-------|----------|
| Strategic blueprint | [monitoring-blueprint.md](monitoring-blueprint.md) |
| TTS main / router | [text-to-speech/src/main.rs](../text-to-speech/src/main.rs) |
| TTS handlers (instrument here) | [text-to-speech/src/handlers.rs](../text-to-speech/src/handlers.rs) |
| TTS K8s service | [text-to-speech/k8s/service.yaml](../text-to-speech/k8s/service.yaml) |
| TTS CNPG database | [text-to-speech/k8s/db.yaml](../text-to-speech/k8s/db.yaml) |
| STT main / router | [speech-to-text/src/main.rs](../speech-to-text/src/main.rs) |
| STT transcribe handler | [speech-to-text/src/transcribe.rs](../speech-to-text/src/transcribe.rs) |
| STT K8s service | [speech-to-text/k8s/service.yaml](../speech-to-text/k8s/service.yaml) |
| WhatsApp entry point | [whatsapp/src/index.ts](../whatsapp/src/index.ts) |
| WhatsApp K8s service | [whatsapp/k8s/service.yaml](../whatsapp/k8s/service.yaml) |
| WhatsApp CNPG database | [whatsapp/k8s/db.yaml](../whatsapp/k8s/db.yaml) |
| workflows-worker source | [web-scraper-kt/](../web-scraper-kt/) (Kotlin/Quarkus) |
| workflows-worker K8s service | [web-scraper-kt/k8s/service.yaml](../web-scraper-kt/k8s/service.yaml) |
| kube-prometheus-stack chart | [https://github.com/prometheus-community/helm-charts](https://github.com/prometheus-community/helm-charts) |
| axum-prometheus crate | [https://crates.io/crates/axum-prometheus](https://crates.io/crates/axum-prometheus) |
| prom-client npm | [https://www.npmjs.com/package/prom-client](https://www.npmjs.com/package/prom-client) |
