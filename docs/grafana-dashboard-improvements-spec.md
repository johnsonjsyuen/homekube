# Grafana Dashboard Improvements Spec (Implementation)

## Problem Statement

The current Grafana dashboards have three issues:
1. **Fractional operations**: `rate(counter[5m])` produces values like `0.003 ops/s` on a low-traffic homelab - meaningless to a human
2. **Non-integer display**: `increase(counter[24h])` can return `4.7` due to Prometheus extrapolation; stat panels lack `decimals: 0`
3. **Weak visualizations**: Count-based timeseries use line charts, which are wrong for sparse discrete events

## Design Decisions

### Decision 1: `increase()` replaces `rate()` for counter timeseries

For a homelab with ~10-50 events/day per service, `rate()` is meaningless. Switch to `increase(counter[1h])` which shows "5 jobs this hour" instead of "0.001 ops/s".

**Exception:** `histogram_quantile()` still requires `rate()` inside it - this is mathematically necessary and the output (seconds) is meaningful.

### Decision 2: Bar chart style for count timeseries

Discrete events per hour are best visualized as bars, not lines. Set `"drawStyle": "bars"` with `"interval": "1h"` on count-based timeseries.

### Decision 3: `round()` and `decimals: 0` on all integer metrics

Wrap all `increase()` calls in `round()` and set `"decimals": 0` in fieldConfig to guarantee whole numbers.

### Decision 4: Default time range `now-6h` for per-service dashboards

With 1-hour bars, a 6-hour window shows 6 data points - enough to see trends. The Overview dashboard stays at `now-1h` (stat panels only).

### Decision 5: Add resource usage panels to Overview

Add CPU and memory for each service pod using `container_cpu_usage_seconds_total` and `container_memory_working_set_bytes` from cadvisor (already scraped by kube-prometheus-stack).

### Decision 6: Add error count panels to per-service dashboards

Add HTTP error panels showing `increase()` of 4xx/5xx responses. Uses `status=~"4.."` and `status=~"5.."` filters.

## Changes Per Dashboard

### Overview Dashboard

| Panel | Change |
|-------|--------|
| Service health (id 1-4) | No change (up/down mappings work correctly) |
| 24h stat panels (id 5-8) | Wrap in `round()`, add `"decimals": 0` |
| NEW: Service CPU | `sum by (pod) (rate(container_cpu_usage_seconds_total{namespace="default",pod=~"(text-to-speech\|speech-to-text\|whatsapp).*",container!=""}[5m]))` + news-worker in temporal namespace |
| NEW: Service Memory | `sum by (pod) (container_memory_working_set_bytes{namespace="default",pod=~"(text-to-speech\|speech-to-text\|whatsapp).*",container!=""})` |
| NEW: HTTP Errors (24h) | `round(sum by (job) (increase(http_requests_total{status=~"[45].."}[24h])))` + axum variant |

### Text-to-Speech Dashboard

| Panel ID | Current | New |
|----------|---------|-----|
| 2 "Jobs by Status" | `rate(tts_jobs_total[5m])` unit=ops, lines | `round(increase(tts_jobs_total[1h]))` unit=short decimals=0, bars, interval=1h |
| 3 "Generation Duration" | Keep as-is | No change (histogram_quantile needs rate, seconds output is meaningful) |
| 4 "HTTP Request Rate" | `rate(axum_http_requests_total[5m])` unit=reqps, lines | `round(increase(axum_http_requests_total[1h]))` renamed "HTTP Requests per Hour", unit=short decimals=0, bars |
| 5 "HTTP Latency p95" | Keep as-is | No change |
| NEW 6 "HTTP Errors per Hour" | - | `round(increase(axum_http_requests_total{status=~"[45].."}[1h]))` bars |

### Speech-to-Text Dashboard

| Panel ID | Current | New |
|----------|---------|-----|
| 2 "Transcription Rate" | `rate(stt_transcriptions_total[5m])` unit=ops | `round(increase(stt_transcriptions_total[1h]))` renamed "Transcriptions per Hour", bars |
| 4 "Audio Segments Rate" | `rate(stt_audio_segments_total[5m])` unit=ops | `round(increase(stt_audio_segments_total[1h]))` renamed "Audio Segments per Hour", bars |
| 5 "HTTP Request Rate" | `rate(axum_http_requests_total[5m])` unit=reqps | `round(increase(axum_http_requests_total[1h]))` renamed "HTTP Requests per Hour", bars |
| 3, 6 | Keep as-is | No change (histogram_quantile) |

### WhatsApp Dashboard

| Panel ID | Current | New |
|----------|---------|-----|
| 2 "Session Connects (24h)" | No `round()` | Add `round()`, `decimals: 0` |
| 3 "Messages Sent vs Received" | `rate()[5m]` unit=ops, lines | `round(increase()[1h])` renamed "Messages per Hour", bars |
| 4 "Messages Total (24h)" | No `round()` | Add `round()`, `decimals: 0` |
| 5 "HTTP Request Rate" | `rate()[5m]` unit=reqps | `round(increase()[1h])` renamed "HTTP Requests per Hour", bars |
| 1, 6 | Keep as-is | No change |

### News Worker Dashboard

| Panel ID | Current | New |
|----------|---------|-----|
| 1 "Workflow Runs (24h)" | No `round()` | Add `round()`, `decimals: 0` |
| 3 "Runs by Status/Workflow" | `rate()[5m]` unit=ops | `round(increase()[1h])` renamed "Runs per Hour", bars |
| 5 "Articles Fetched" | `rate()[5m]` unit=ops | `round(increase()[1h])` renamed "Articles Fetched per Hour", bars |
| 6 "Messages Sent" | `rate()[5m]` unit=ops | `round(increase()[1h])` renamed "Messages Sent per Hour", bars |
| 7 "HTTP Request Rate" | `rate()[5m]` unit=reqps | `round(increase()[1h])` renamed "HTTP Requests per Hour", bars |
| 2, 4, 8 | Keep as-is | No change |

## Panel Template: Count-Based Timeseries (Bar Style)

All converted count panels follow this pattern:

```json
{
  "type": "timeseries",
  "targets": [{
    "expr": "round(sum by (label) (increase(metric_total[1h])))",
    "interval": "1h"
  }],
  "fieldConfig": {
    "defaults": {
      "unit": "short",
      "decimals": 0,
      "custom": {
        "drawStyle": "bars",
        "barAlignment": 0,
        "fillOpacity": 80,
        "stacking": { "mode": "normal" }
      }
    }
  }
}
```

## Panel Template: Stat with Integer Display

```json
{
  "type": "stat",
  "targets": [{
    "expr": "round(sum(increase(metric_total[24h])))"
  }],
  "fieldConfig": {
    "defaults": {
      "decimals": 0
    }
  }
}
```

## Root Cause: Missing Custom Metrics (TTS + STT)

TTS and STT dashboards showed "No data" on all custom business metric panels (jobs, transcriptions, durations, active sessions). The root cause was a `metrics` crate version mismatch:

- `Cargo.toml` declared `metrics = "0.22"` (resolves to `0.22.x`)
- `axum-prometheus = "0.7"` depends on `metrics 0.23.x`
- Cargo compiled BOTH versions as separate crates
- `axum-prometheus` installed a global recorder for `metrics 0.23`
- App code `metrics::counter!()` calls used the `0.22` facade, hitting a noop recorder
- Custom metrics silently dropped; only HTTP metrics (recorded by axum-prometheus middleware) appeared

**Fix:** Changed `metrics = "0.22"` to `metrics = "0.23"` in both `text-to-speech/Cargo.toml` and `speech-to-text/Cargo.toml`, then rebuilt Docker images.

## Anti-Patterns (DO NOT)

| Don't | Do Instead | Why |
|-------|-----------|-----|
| Use `rate()` on counters for homelab timeseries | Use `increase()[1h]` with bars | rate() gives meaningless fractions at low traffic |
| Use `increase()` inside `histogram_quantile()` | Always use `rate()` inside histogram_quantile | Mathematically required for correct percentile computation |
| Display `increase()` without `round()` | Always wrap in `round()` | Prometheus extrapolation produces non-integers |
| Use line charts for discrete count events | Use `drawStyle: "bars"` | Lines imply continuous values; bars show discrete counts |
| Set `interval` different from `increase()` window | Match `"interval": "1h"` with `increase()[1h]` | Mismatched intervals cause double-counting or gaps |
| Use `$__rate_interval` with `increase()` | Use explicit `[1h]` window | `$__rate_interval` is designed for `rate()`, not `increase()` |
| Use a different `metrics` crate version than `axum-prometheus` | Match the version axum-prometheus depends on | Cargo compiles both as separate crates; custom metrics hit noop recorder |

## References

| Topic | Location |
|-------|----------|
| Current dashboard YAMLs | [monitoring/crossplane/dashboards/](../monitoring/crossplane/dashboards/) |
| Monitoring implementation spec | [docs/monitoring-spec.md](monitoring-spec.md) |
| Metric definitions (Rust) | [text-to-speech/src/metrics.rs](../text-to-speech/src/metrics.rs), [speech-to-text/src/metrics.rs](../speech-to-text/src/metrics.rs) |
| Metric definitions (Node.js) | [whatsapp/src/metrics.ts](../whatsapp/src/metrics.ts), [news-worker/src/metrics.ts](../news-worker/src/metrics.ts) |
| Crossplane dashboard README | [monitoring/crossplane/README.md](../monitoring/crossplane/README.md) |
