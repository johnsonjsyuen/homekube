# Claude Code API — Implementation Spec (Implementation)

## Context

A Rust/Axum HTTP service that wraps the Claude Code CLI, providing a JSON API for AI analysis requests. Replaces the current kubectl exec pattern used by web-scraper and news-worker.

Deployed to the `default` namespace as a ClusterIP service. No external authentication — internal service only.

---

## 1. Service Overview

| Property | Value |
|----------|-------|
| Language | Rust (Edition 2024) |
| Framework | Axum 0.7 |
| Port | 3000 |
| Namespace | `default` |
| Service name | `claude-code-api` |
| Image | `localhost:5000/claude-code-api:latest` |
| Base Docker image | `node:22-slim` (needs Node.js for Claude Code CLI) |

**Implementation Implication:** The Docker image must include both the compiled Rust binary AND Node.js + `@anthropic-ai/claude-code`. The Rust binary invokes `claude` via `tokio::process::Command`.

---

## 2. File Structure

```
claude-code-api/
├── Cargo.toml
├── Dockerfile
├── build.sh
├── src/
│   ├── main.rs          # Axum server, routes, health check
│   ├── claude.rs         # Claude CLI invocation logic
│   └── metrics.rs        # Prometheus metric definitions
└── k8s/
    ├── deploy.yaml       # Deployment + Service (combined)
    └── service-monitor.yaml
```

**Implementation Implication:** Minimal file count. No database, no Kafka, no auth middleware. This is a thin HTTP wrapper around the CLI.

---

## 3. Dependencies (Cargo.toml)

```toml
[package]
name = "claude-code-api"
version = "0.1.0"
edition = "2024"

[dependencies]
axum = { version = "0.7", features = ["macros"] }
tokio = { version = "1", features = ["full", "process"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
tracing = "0.1"
tracing-subscriber = "0.3"
anyhow = "1.0"
tower-http = { version = "0.5", features = ["cors"] }
axum-prometheus = "0.7"
metrics = "0.23"
```

**Implementation Implication:** Matches the dependency patterns from `speech-to-text/Cargo.toml` and `speedtest/Cargo.toml`. Uses `tracing` (not `log`+`env_logger`) to match the speech-to-text pattern. `tokio` needs the `process` feature for async subprocess execution.

---

## 4. API Endpoints

### POST `/api/analyze`

**Purpose:** Send a prompt to Claude Code CLI and return the response.

**Request:**

```json
{
  "prompt": "string (required, the full prompt text)",
  "output_format": "text | json",
  "timeout_seconds": 120
}
```

| Field | Type | Required | Default | Constraints |
|-------|------|----------|---------|-------------|
| `prompt` | string | yes | — | Max 100,000 chars |
| `output_format` | string | no | `"text"` | `"text"` or `"json"` |
| `timeout_seconds` | u32 | no | 120 | Min 10, max 300 |

**Response (200 OK):**

```json
{
  "response": "string (Claude's full text output)",
  "duration_ms": 1523
}
```

**Error responses:**

| Status | Body | Condition |
|--------|------|-----------|
| 400 | `{ "error": "prompt is required" }` | Missing or empty prompt |
| 400 | `{ "error": "prompt exceeds 100000 character limit" }` | Prompt too long |
| 400 | `{ "error": "invalid output_format, must be 'text' or 'json'" }` | Bad output_format |
| 408 | `{ "error": "claude timed out after 120s" }` | Process exceeded timeout |
| 502 | `{ "error": "claude process failed: <stderr>" }` | Non-zero exit code |
| 503 | `{ "error": "claude command not found" }` | CLI not installed |

**Implementation Implication:** The endpoint is intentionally generic — it accepts any prompt and returns raw Claude output. The caller (web-scraper, news-worker) is responsible for constructing the prompt and parsing the response. This keeps the API service simple and reusable.

### GET `/health`

**Response (200 OK):**

```json
{
  "status": "ok",
  "claude_available": true
}
```

**Logic:**
1. Run `claude --version` with 5-second timeout
2. If succeeds: `claude_available: true`, return 200
3. If fails: `claude_available: false`, return 200

**Implementation Implication:** Kubernetes liveness probe points to `/health` (always 200 — service is up).

### GET `/ready`

**Response:** 200 if Claude is available, 503 if not.

**Logic:** Same check as `/health`, but returns 503 when `claude_available: false`.

**Implementation Implication:** Kubernetes readiness probe points to `/ready`. When Claude is unavailable (e.g., missing API key), the pod is removed from the Service endpoints so callers get immediate connection failures instead of 503 responses.

### GET `/metrics`

Standard Prometheus metrics via `axum-prometheus`. No authentication.

---

## 5. Claude CLI Invocation (`claude.rs`)

### Process Execution

```rust
// Pseudocode — actual implementation
async fn invoke_claude(prompt: &str, output_format: &str, timeout: Duration) -> Result<String> {
    let mut child = Command::new("claude")
        .args(["--output-format", output_format, "-p", "-"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;

    // Write prompt to stdin
    child.stdin.take().unwrap().write_all(prompt.as_bytes()).await?;

    // Wait with timeout
    let output = tokio::time::timeout(timeout, child.wait_with_output()).await??;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        bail!("claude process failed: {stderr}");
    }

    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}
```

**Implementation Implication:**
- Use `tokio::process::Command` for async subprocess execution.
- Pipe prompt via stdin to avoid ARG_MAX limits (prompts can be >100KB).
- Capture stderr separately for error diagnostics.
- Kill child process on timeout (tokio::time::timeout drops the future, which drops the child).

### Concurrency

| Property | Value | Rationale |
|----------|-------|-----------|
| Max concurrent requests | 3 | Claude Code is CPU/memory intensive. Limit concurrency with a semaphore. |
| Queue behavior | Await semaphore | Requests wait in FIFO order when all 3 slots are occupied. |
| Backpressure | None (rely on Temporal retry) | If requests queue up, callers retry via Temporal activity retry policy. |

**Implementation Implication:** Use `tokio::sync::Semaphore` with 3 permits. Acquire before spawning child process, release after completion. This prevents OOM from too many concurrent Claude processes.

---

## 6. Dockerfile

```dockerfile
# Stage 1: Build Rust binary
FROM rust:1.85-slim AS builder
WORKDIR /app
COPY Cargo.toml Cargo.lock ./
RUN mkdir src && echo 'fn main(){}' > src/main.rs && cargo build --release && rm -rf src
COPY src/ src/
RUN touch src/main.rs && cargo build --release

# Stage 2: Runtime with Node.js + Claude Code
FROM node:22-slim
RUN npm install -g @anthropic-ai/claude-code
COPY --from=builder /app/target/release/claude-code-api /usr/local/bin/
EXPOSE 3000
ENV RUST_LOG=info
CMD ["claude-code-api"]
```

**Implementation Implication:** Two-stage build. The runtime image is `node:22-slim` (not a Rust image) because Claude Code CLI requires Node.js. The compiled Rust binary is statically linked and copied in. Image will be ~300MB (mostly Node.js + Claude Code npm package).

---

## 7. Environment Variables

| Variable | Default | Required | Description |
|----------|---------|----------|-------------|
| `PORT` | `3000` | no | HTTP listen port |
| `RUST_LOG` | `info` | no | Tracing filter level |
| `ANTHROPIC_API_KEY` | — | yes | API key for Claude Code CLI |
| `MAX_CONCURRENT` | `3` | no | Max concurrent Claude invocations |

**Implementation Implication:** `ANTHROPIC_API_KEY` is injected from Kubernetes secret `claude-code-api-key`. The existing `claude-code-api-key` secret can be reused from the current claude-code deployment.

---

## 8. Kubernetes Manifests

### `k8s/deploy.yaml` — Deployment + Service

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: claude-code-api
  namespace: default
spec:
  replicas: 1
  selector:
    matchLabels:
      app: claude-code-api
  template:
    metadata:
      labels:
        app: claude-code-api
    spec:
      containers:
      - name: claude-code-api
        image: localhost:5000/claude-code-api:latest
        ports:
        - containerPort: 3000
        env:
        - name: ANTHROPIC_API_KEY
          valueFrom:
            secretKeyRef:
              name: claude-code-api-key
              key: api-key
        - name: RUST_LOG
          value: "info"
        resources:
          requests:
            memory: "256Mi"
            cpu: "100m"
          limits:
            memory: "1Gi"
        livenessProbe:
          httpGet:
            path: /health
            port: 3000
          initialDelaySeconds: 10
          periodSeconds: 30
        readinessProbe:
          httpGet:
            path: /ready
            port: 3000
          initialDelaySeconds: 5
          periodSeconds: 10
---
apiVersion: v1
kind: Service
metadata:
  name: claude-code-api
  namespace: default
spec:
  selector:
    app: claude-code-api
  ports:
  - name: http
    port: 80
    targetPort: 3000
```

**Implementation Implication:** Memory limit is 1Gi (higher than other services) because Claude Code CLI + Node.js + Rust binary all run in the same container. No ServiceAccount needed — no kubectl exec, no cross-namespace access.

### `k8s/service-monitor.yaml`

```yaml
apiVersion: monitoring.coreos.com/v1
kind: ServiceMonitor
metadata:
  name: claude-code-api
  namespace: default
  labels:
    release: kube-prometheus-stack
spec:
  selector:
    matchLabels:
      app: claude-code-api
  endpoints:
  - port: http
    path: /metrics
    interval: 30s
```

---

## 9. Prometheus Metrics

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `claude_requests_total` | Counter | `status` (success, error, timeout) | Total analyze requests |
| `claude_request_duration_seconds` | Histogram | — | End-to-end request duration (buckets: 1, 5, 10, 30, 60, 120, 180, 300) |
| `claude_prompt_chars_total` | Counter | — | Total characters sent to Claude |
| `claude_concurrent_requests` | Gauge | — | Currently executing requests |

**Implementation Implication:** Use `metrics` crate (same as speech-to-text). `axum-prometheus` provides HTTP-level metrics automatically. The above are application-level metrics defined in `metrics.rs`.

---

## 10. Anti-Patterns (DO NOT)

| Don't | Do Instead | Why |
|-------|-----------|-----|
| Add authentication to the API | Keep it internal-only (ClusterIP) | All callers are internal services that handle their own auth. Adding auth here duplicates effort. |
| Parse or validate Claude's response content | Return raw response to caller | The API is a transport layer. Callers know their own response schemas. |
| Buffer entire stdout in memory before returning | Stream stdout to response buffer | Claude output can be large; avoid double-buffering |
| Use `std::process::Command` (blocking) | Use `tokio::process::Command` (async) | Blocking IO in async context starves the executor |
| Let concurrent requests be unbounded | Use `Semaphore` with configurable limit | Claude processes are resource-heavy; unbounded spawning causes OOM |
| Retry failed Claude invocations internally | Let caller (Temporal) handle retries | Temporal already has retry policies; internal retries cause cascading timeouts |
| Log the full prompt text | Log prompt length and first 100 chars | Prompts can be 100KB+; logging them bloats log storage |
| Hardcode the `claude` binary path | Use `Command::new("claude")` (PATH lookup) | The binary location depends on npm global install path |
| Add request queuing or persistence | Fail fast, let caller retry | This is a stateless proxy, not a job queue |
| Install Claude Code at runtime | Install in Dockerfile at build time | Startup time, network dependency, version pinning |

---

## 11. Test Case Specifications

### Unit Tests

| Test ID | Component | Input | Expected Output | Edge Cases |
|---------|-----------|-------|-----------------|------------|
| TC-001 | POST /api/analyze | Valid prompt, default options | 200 + response text | Empty prompt (400), oversized prompt (400) |
| TC-002 | POST /api/analyze | Custom timeout_seconds: 10 | 200 or 408 if slow | timeout_seconds: 0 (400), timeout_seconds: 999 (400) |
| TC-003 | POST /api/analyze | output_format: "json" | 200 + JSON response | output_format: "xml" (400) |
| TC-004 | GET /health | — | 200 + claude_available boolean | Claude not installed (available: false) |
| TC-005 | Semaphore | 5 concurrent requests, MAX_CONCURRENT=3 | 3 execute, 2 wait | All 5 eventually complete |
| TC-006 | Timeout handling | Prompt that takes >timeout | 408 + error message | Process killed on timeout |
| TC-007 | Claude stderr | Prompt that causes Claude error | 502 + stderr message | Empty stderr |

### Integration Tests

| Test ID | Flow | Setup | Verification | Teardown |
|---------|------|-------|--------------|----------|
| IT-001 | Analyze request | Running service + API key | Send prompt, get valid response | — |
| IT-002 | Health check | Running service | /health returns claude_available: true | — |
| IT-003 | Concurrent load | Running service | 3 simultaneous requests all complete | — |

---

## 12. Error Handling Matrix

| Error Type | Detection | Response | Fallback | Logging |
|------------|-----------|----------|----------|---------|
| Empty/missing prompt | Request validation | 400 + specific message | — | WARN |
| Prompt too long (>100K chars) | Request validation | 400 + specific message | — | WARN |
| Claude CLI not found | `Command::spawn` returns NotFound | 503 + error message | — | ERROR |
| Claude process non-zero exit | `output.status.success() == false` | 502 + stderr content | — | ERROR |
| Claude process timeout | `tokio::time::timeout` elapsed | 408 + timeout message | Kill child process | WARN |
| Semaphore exhausted (waiting) | Semaphore acquire blocks | Request waits (no error) | — | DEBUG (log queue depth) |
| stdin write failure | `write_all` returns error | 502 + error message | — | ERROR |
| Invalid output_format | Request validation | 400 + specific message | — | WARN |

---

## 13. References

| Topic | Location |
|-------|----------|
| Strategic blueprint | [00-strategic-blueprint.md](./00-strategic-blueprint.md) |
| Web scraper rewrite spec | [02-web-scraper-rewrite-spec.md](./02-web-scraper-rewrite-spec.md) |
| Existing Rust/Axum service pattern | `speech-to-text/src/main.rs` |
| Existing Rust Cargo.toml pattern | `speech-to-text/Cargo.toml` |
| Existing Prometheus metrics pattern | `speech-to-text/Cargo.toml` (axum-prometheus) |
| Current kubectl exec pattern to replace | `web-scraper/src/activities/analyseWithClaude.ts` |
| Claude Code deployment | `claude-code/k8s/deployment.yaml` |
| Claude Code Dockerfile | `claude-code/Dockerfile` |
| Build script pattern | `speedtest/build.sh` |
| K8s ServiceMonitor pattern | `web-scraper/k8s/service-monitor.yaml` |
