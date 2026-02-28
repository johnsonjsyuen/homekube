# Homekube Monitoring (Strategic)

## 1. Problem Statement

The homekube k3s cluster has zero observability. There are no metrics, no dashboards, and no alerts. When a service is slow or a workflow fails, the only diagnostic tool is manually reading pod logs.

Specific gaps:

- **No metrics collection.** CNPG database clusters already declare `enablePodMonitor: true` across six databases (text-to-speech, whatsapp, keycloak, tansu, speedtest, temporal), but no Prometheus instance exists to scrape them.
- **No application metrics.** The four custom services (TTS, STT, WhatsApp, news-worker) expose no `/metrics` endpoints. There is no way to track request rates, latencies, or error counts.
- **No business metrics.** There is no visibility into TTS job throughput, STT transcription counts, WhatsApp message volumes, or Temporal workflow success rates.
- **No dashboards.** Node-level resource usage (CPU, memory, disk) requires manual `kubectl top` or SSH access to the host.

**Implementation Implication:** The system needs a metrics pipeline (Prometheus), a visualization layer (Grafana), and instrumentation in each service. The existing CNPG PodMonitor declarations mean database metrics will flow automatically once Prometheus is installed.

## 2. Success Metrics

- All four services expose `/metrics` endpoints returning Prometheus exposition format
- Prometheus scrapes all targets (4 services + CNPG databases) and all show status UP
- Grafana provides default dashboards for node metrics, Kubernetes resources, and CoreDNS
- Custom business metrics are queryable in Prometheus:
  - TTS: job counts by status, generation duration, active jobs
  - STT: transcription counts, transcription duration, active sessions
  - WhatsApp: messages sent/received, active sessions, session connects
  - news-worker: workflow run counts, workflow duration, articles fetched, messages sent
- 15-day metric retention with homelab-sized resource usage (under 2 GiB RAM for Prometheus)

**Implementation Implication:** Rust services use the `metrics` crate ecosystem. Node.js services use `prom-client`. ServiceMonitor CRDs handle Prometheus target discovery.

## 3. Architecture Decision

Use `kube-prometheus-stack` (the most widely adopted Helm chart for Kubernetes monitoring), which bundles Prometheus, Grafana, node-exporter, and kube-state-metrics in a single deployment:

| Component | Technology | Purpose |
|-----------|-----------|---------|
| Metrics collection | Prometheus (via kube-prometheus-stack) | Scrape and store time-series metrics |
| Visualization | Grafana (via kube-prometheus-stack) | Dashboards and ad-hoc PromQL queries |
| Node metrics | node-exporter (via kube-prometheus-stack) | CPU, memory, disk, network per node |
| K8s metrics | kube-state-metrics (via kube-prometheus-stack) | Pod, deployment, and resource object states |
| Rust HTTP metrics | `axum-prometheus` crate | Automatic request duration/count histograms on axum routes |
| Rust business metrics | `metrics` crate | Custom counters, gauges, and histograms |
| Node.js metrics | `prom-client` | Default process metrics + custom counters/histograms |
| Service discovery | ServiceMonitor CRDs | Prometheus auto-discovers scrape targets by label selectors |
| Database metrics | CNPG PodMonitor | Already declared, activates when Prometheus operator is present |

**Rationale:** kube-prometheus-stack is the community standard. It provides working defaults (dashboards, recording rules, scrape configs) with minimal configuration. Using ServiceMonitor CRDs keeps monitoring config co-located with each service rather than centralized in a Prometheus config file.

## 4. What We're Building (MVP)

1. **kube-prometheus-stack Helm chart** in a `monitoring` namespace with homelab-sized resource limits
2. **`/metrics` endpoints** on all four services (TTS, STT, WhatsApp, news-worker)
3. **Custom business metrics** -- TTS jobs, STT transcriptions, WhatsApp messages, workflow runs
4. **ServiceMonitor CRDs** for each service (deployed in the service's own namespace)
5. **CNPG PodMonitor auto-discovery** -- already configured, activates on Prometheus install

## 5. What We're NOT Building

- No AlertManager rules (homelab does not need paging infrastructure yet)
- No distributed tracing (OpenTelemetry/Jaeger is a separate future concern)
- No log aggregation (Loki/ELK -- logs remain via `kubectl logs` for now)
- No custom Grafana dashboards (the default kube-prometheus-stack dashboards plus ad-hoc PromQL queries are sufficient for MVP)
- No external monitoring or uptime checks

## REFERENCES

### Implementation Details Location

| Content Type | Location |
|--------------|----------|
| Helm chart configuration | [Implementation Spec, Section 1](monitoring-spec.md#1-helm-chart-configuration) |
| Rust instrumentation | [Implementation Spec, Section 2](monitoring-spec.md#2-rust-service-instrumentation-tts--stt) |
| Node.js instrumentation | [Implementation Spec, Section 3](monitoring-spec.md#3-nodejs-service-instrumentation-whatsapp--news-worker) |
| Kubernetes manifests | [Implementation Spec, Section 4](monitoring-spec.md#4-kubernetes-manifests) |
| Verification checklist | [Implementation Spec, Section 5](monitoring-spec.md#5-verification-checklist) |
| Anti-patterns | [Implementation Spec, Section 6](monitoring-spec.md#6-anti-patterns) |

### Existing Code References

| Topic | Location |
|-------|----------|
| TTS main / router | [text-to-speech/src/main.rs](../text-to-speech/src/main.rs) |
| TTS Cargo dependencies | [text-to-speech/Cargo.toml](../text-to-speech/Cargo.toml) |
| TTS K8s service | [text-to-speech/k8s/service.yaml](../text-to-speech/k8s/service.yaml) |
| TTS CNPG database | [text-to-speech/k8s/db.yaml](../text-to-speech/k8s/db.yaml) |
| STT main / router | [speech-to-text/src/main.rs](../speech-to-text/src/main.rs) |
| STT Cargo dependencies | [speech-to-text/Cargo.toml](../speech-to-text/Cargo.toml) |
| STT K8s service | [speech-to-text/k8s/service.yaml](../speech-to-text/k8s/service.yaml) |
| WhatsApp entry point | [whatsapp/src/index.ts](../whatsapp/src/index.ts) |
| WhatsApp K8s service | [whatsapp/k8s/service.yaml](../whatsapp/k8s/service.yaml) |
| WhatsApp CNPG database | [whatsapp/k8s/db.yaml](../whatsapp/k8s/db.yaml) |
| news-worker entry point | [news-worker/src/index.ts](../news-worker/src/index.ts) |
| news-worker activities | [news-worker/src/activities/index.ts](../news-worker/src/activities/index.ts) |
| news-worker K8s service | [news-worker/k8s/service.yaml](../news-worker/k8s/service.yaml) |

*This document provides strategic overview. See [Implementation Spec](monitoring-spec.md) for technical details.*
