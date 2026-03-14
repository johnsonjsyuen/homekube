# TTS API/Worker Split — Implementation Spec

## 1. Architecture Overview

```
                    ┌─────────────────────┐
                    │   tts-models PVC    │
                    │   (RWO + readOnly)  │
                    │   kokoro-v1.0.onnx  │
                    │   voices-v1.0.bin   │
                    └────┬──────────┬─────┘
                    ro   │          │  ro
          ┌──────────────┘          └──────────────┐
          ▼                                        ▼
┌──────────────────┐        Kafka           ┌──────────────────┐
│    tts-api       │   topic: tts-jobs      │   tts-worker     │
│    (1 replica)   │ ──────────────────►    │   (KEDA: 1-5)    │
│                  │                        │                  │
│  /generate       │                        │  rdkafka consumer│
│  /status/:id     │                        │  group: tts-wrkr │
│  /jobs           │                        │  process_tts()   │
│  /ws/live        │                        │  /health         │
│  /health         │                        │                  │
│  /metrics        │                        │                  │
└───────┬──────────┘                        └────────┬─────────┘
        │ rw                                         │ rw
        └────────────────┬───────────────────────────┘
                         ▼
               ┌──────────────────┐
               │ tts-storage PVC  │
               │ (RWO)            │
               │ audio output +   │
               │ pending text     │
               └──────────────────┘
```

**Two binaries, one Docker image.** Deployments use different `command` to select binary.

## 2. Cargo Project Structure

```
text-to-speech/
├── src/
│   ├── lib.rs              # Module re-exports
│   ├── bin/
│   │   ├── api.rs          # API server binary
│   │   └── worker.rs       # Kafka consumer worker binary
│   ├── auth.rs             # (API only — but compiled into both)
│   ├── cleanup.rs          # (API only)
│   ├── handlers.rs         # generate_speech, check_status, list_jobs, process_tts
│   ├── inference.rs        # KokoroModel ONNX (API only — WebSocket live TTS)
│   ├── kafka_producer.rs   # rdkafka producer (API only)
│   ├── kafka_consumer.rs   # rdkafka consumer with consumer group (Worker only)
│   ├── metrics.rs          # Shared metrics constants
│   ├── phonemizer.rs       # (API only — WebSocket live TTS)
│   ├── state.rs            # AppState (API only)
│   └── ws_handler.rs       # (API only)
```

### Cargo.toml Changes

| Action | Dependency | Notes |
|--------|-----------|-------|
| Remove | `rskafka = "0.5"` | No consumer group support |
| Add | `rdkafka = { version = "0.36", features = ["cmake-build"] }` | Full Kafka protocol, statically links librdkafka |
| Add | `[[bin]] name = "tts-api"` | API binary, path = `src/bin/api.rs` |
| Add | `[[bin]] name = "tts-worker"` | Worker binary, path = `src/bin/worker.rs` |
| Remove | `[[bin]] name = "text-to-speech"` | Was implicit via `src/main.rs` |

### lib.rs

Declares all modules as `pub mod`. Both binaries import from the library crate.

```rust
pub mod auth;
pub mod cleanup;
pub mod handlers;
pub mod inference;
pub mod kafka_consumer;
pub mod kafka_producer;
pub mod metrics;
pub mod phonemizer;
pub mod state;
pub mod ws_handler;
```

## 3. Kafka Migration: rskafka → rdkafka

### Producer (kafka_producer.rs)

| Aspect | Spec |
|--------|------|
| Client | `rdkafka::producer::FutureProducer` |
| Topic | `tts-jobs` |
| Key | `job_id` (string) |
| Value | JSON-serialized `TtsJobMessage` |
| Acks | `all` (wait for all ISR replicas) |
| Config | `bootstrap.servers`, `message.timeout.ms = 5000` |

```rust
pub struct KafkaProducer {
    producer: FutureProducer,
}

impl KafkaProducer {
    pub fn new(brokers: &str) -> Result<Self, KafkaError>;
    pub async fn produce_tts_job(&self, msg: &TtsJobMessage) -> Result<(), Box<dyn Error + Send + Sync>>;
}
```

### Consumer (kafka_consumer.rs)

| Aspect | Spec |
|--------|------|
| Client | `rdkafka::consumer::StreamConsumer` |
| Topic | `tts-jobs` |
| Consumer group | `tts-workers` |
| Auto offset reset | `earliest` (process all unprocessed messages) |
| Enable auto commit | `false` (manual commit after successful processing) |
| Session timeout | `30000` ms |
| Max poll interval | `600000` ms (10 min — TTS jobs can be slow) |

```rust
pub async fn run_consumer(brokers: &str, pool: Pool<Postgres>, storage_path: String) -> Result<(), Box<dyn Error + Send + Sync>>;
```

**Consumer loop:**
1. Create `StreamConsumer` with config above
2. Subscribe to `tts-jobs` topic
3. For each message:
   a. Deserialize `TtsJobMessage` from value
   b. Parse `job_id` as UUID
   c. Idempotency check: `SELECT status FROM jobs WHERE id = $1` — skip if not `pending`
   d. Update status to `processing`
   e. Decode base64 text
   f. `spawn_blocking` → `process_tts()`
   g. On success: commit offset, update metrics
   h. On failure: update DB with error, commit offset (don't reprocess known failures)

**Offset commit strategy:** Commit after EACH message (sync commit). This ensures:
- Successful jobs are not reprocessed
- Failed jobs are committed too (error stored in DB, no retry loop)
- Crash before commit → message redelivered → idempotency check prevents double processing

### TtsJobMessage (shared)

Stays in `kafka_producer.rs` (or a shared `types.rs`), unchanged:

```rust
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TtsJobMessage {
    pub job_id: String,
    pub username: String,
    pub text_base64: String,
    pub voice: String,
    pub speed: String,
    pub input_filename: Option<String>,
    pub timestamp: String,
}
```

## 4. API Binary (src/bin/api.rs)

Same as current `main.rs` with these changes:

| Change | Detail |
|--------|--------|
| Remove | Kafka consumer spawn (`start_tts_consumer`) |
| Remove | `recover_pending_jobs` logic |
| Replace | `kafka::KafkaProducer` → `kafka_producer::KafkaProducer` |
| Keep | Kokoro model loading, WebSocket handler, cleanup task |
| Keep | All HTTP routes unchanged |

The API binary does NOT process TTS jobs. It only:
1. Accepts requests
2. Inserts job into DB
3. Saves text to PVC (`pending/{job_id}.txt`)
4. Produces Kafka message
5. Serves status/results

## 5. Worker Binary (src/bin/worker.rs)

Minimal binary:

```rust
#[tokio::main]
async fn main() {
    tracing_subscriber::fmt::init();

    // Load config from env
    let database_url = env::var("DATABASE_URL").expect("DATABASE_URL");
    let storage_path = env::var("STORAGE_PATH").unwrap_or("/app/storage".into());
    let kafka_brokers = env::var("KAFKA_BROKERS").expect("KAFKA_BROKERS");

    // Create storage dirs
    tokio::fs::create_dir_all(&storage_path).await.unwrap();
    tokio::fs::create_dir_all(format!("{}/pending", storage_path)).await.unwrap();

    // Connect to DB
    let pool = PgPoolOptions::new()
        .max_connections(5)
        .connect(&database_url).await.expect("DB connection");

    // Run migrations
    sqlx::migrate!().run(&pool).await.expect("migrations");

    // Spawn health server on port 3001
    tokio::spawn(health_server());

    // Run Kafka consumer (blocks forever, reconnects on error)
    kafka_consumer::run_consumer(kafka_brokers, pool, storage_path).await;
}

async fn health_server() {
    let app = Router::new().route("/health", get(|| async { "OK" }));
    let listener = TcpListener::bind("0.0.0.0:3001").await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
```

## 6. Dockerfile

Single Dockerfile producing image with both binaries.

### Builder stage changes

| Change | Detail |
|--------|--------|
| Add | `cmake` to build deps (for rdkafka cmake-build feature) |
| Build | `cargo build --release` produces both binaries |

### Runtime stage

Unchanged — Python 3.11-slim with ffmpeg, espeak-ng, kokoro-tts, soundfile.

Both binaries copied:
```dockerfile
COPY --from=builder /app/target/release/tts-api /usr/local/bin/tts-api
COPY --from=builder /app/target/release/tts-worker /usr/local/bin/tts-worker
```

Default CMD: `tts-api` (overridden by k8s `command` for worker).

## 7. Kubernetes Manifests

### 7.1 tts-models PVC (k8s/model-pvc.yaml)

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: tts-models
spec:
  accessModes: [ReadWriteOnce]  # Single-node cluster; mounted readOnly by pods
  resources:
    requests:
      storage: 2Gi
```

**Implementation note:** True ROX requires NFS or similar. On single-node cluster, RWO PVC + `readOnly: true` volumeMount achieves equivalent semantics. All pods are on the same node so RWO doesn't block concurrent read-only mounts.

### 7.2 Model Download Job (k8s/model-job.yaml)

Kubernetes Job that downloads models with version stamping. Replaces the init container from the old deployment.

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: tts-model-init
spec:
  template:
    spec:
      restartPolicy: OnFailure
      containers:
      - name: download-models
        image: busybox:1.36
        env:
        - name: MODEL_VERSION
          value: "v1.0.0"
        - name: ONNX_URL
          value: "https://github.com/nazdridoy/kokoro-tts/releases/download/v1.0.0/kokoro-v1.0.onnx"
        - name: VOICES_URL
          value: "https://github.com/nazdridoy/kokoro-tts/releases/download/v1.0.0/voices-v1.0.bin"
        command: ['sh', '-c']
        args:
        - |
          STAMP="/models/.version"
          if [ -f "$STAMP" ] && [ "$(cat "$STAMP")" = "$MODEL_VERSION" ]; then
            echo "Models already at version $MODEL_VERSION"
          else
            echo "Downloading models..."
            wget -q -O /models/kokoro-v1.0.onnx "$ONNX_URL"
            wget -q -O /models/voices-v1.0.bin "$VOICES_URL"
            echo "$MODEL_VERSION" > "$STAMP"
            echo "Done"
          fi
        volumeMounts:
        - name: models
          mountPath: /models
      volumes:
      - name: models
        persistentVolumeClaim:
          claimName: tts-models
```

**Version invalidation:** Change `MODEL_VERSION` env var → Job re-downloads. Run via `build.sh` before deploying pods.

### 7.3 API Deployment (k8s/api-deploy.yaml)

| Field | Value |
|-------|-------|
| Name | `tts-api` |
| Replicas | 1 |
| Container command | `["tts-api"]` |
| Port | 3000 |
| Model PVC mount | `/app/models` readOnly: true |
| Storage PVC mount | `/app/storage` |
| Env: KOKORO_MODEL_PATH | `/app/models/kokoro-v1.0.onnx` |
| Env: KOKORO_VOICES_PATH | `/app/models/voices-v1.0.bin` |
| Env: KOKORO_MODEL_DIR | `/app/models` |
| Resources | 500m CPU / 2Gi RAM request, 6Gi limit |

### 7.4 Worker Deployment (k8s/worker-deploy.yaml)

| Field | Value |
|-------|-------|
| Name | `tts-worker` |
| Replicas | Managed by KEDA (do NOT set) |
| Container command | `["tts-worker"]` |
| Port | 3001 (health only) |
| Model PVC mount | `/app/models` readOnly: true |
| Storage PVC mount | `/app/storage` |
| Env: KOKORO_MODEL_DIR | `/app/models` |
| No KOKORO_MODEL_PATH/VOICES_PATH | Worker uses CLI, not ONNX inference |
| Resources | 500m CPU / 2Gi RAM request, 6Gi limit |
| Liveness probe | HTTP GET /health :3001 |
| Readiness probe | HTTP GET /health :3001 |

### 7.5 KEDA ScaledObject (k8s/keda-scaledobject.yaml)

```yaml
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata:
  name: tts-worker-scaler
spec:
  scaleTargetRef:
    name: tts-worker
  minReplicaCount: 1
  maxReplicaCount: 5
  pollingInterval: 15
  cooldownPeriod: 300
  triggers:
  - type: kafka
    metadata:
      bootstrapServers: tansu.default.svc.cluster.local:9092
      consumerGroup: tts-workers
      topic: tts-jobs
      lagThreshold: "2"
      offsetResetPolicy: earliest
```

**Scaling behavior:**
- Lag ≤ 2: 1 replica (min)
- Lag > 2: Scale up (1 additional replica per 2 messages of lag)
- Cooldown: 5 min before scale-down
- Max: 5 replicas

### 7.6 Service (k8s/service.yaml)

Update selector to target `tts-api` instead of `text-to-speech`. Port 80→3000 unchanged.

### 7.7 Files to delete

| File | Reason |
|------|--------|
| `k8s/deploy.yaml` | Replaced by `api-deploy.yaml` + `worker-deploy.yaml` |

### 7.8 Files unchanged

| File | Reason |
|------|--------|
| `k8s/db.yaml` | Database unchanged |
| `k8s/pvc.yaml` | Renamed purpose: output storage (not models) |
| `k8s/service-monitor.yaml` | Monitoring unchanged (targets API) |

## 8. build.sh

```bash
#!/bin/bash
set -eu
cd "$(dirname "$0")"

echo "Building Docker image..."
docker build --platform linux/amd64 . -t localhost:5000/text-to-speech:latest

echo "Pushing to local registry..."
docker push localhost:5000/text-to-speech:latest

echo "Applying Kubernetes manifests..."
kubectl apply -f k8s/

echo "Running model download job (if needed)..."
kubectl delete job tts-model-init --ignore-not-found
kubectl apply -f k8s/model-job.yaml
kubectl wait --for=condition=complete job/tts-model-init --timeout=300s

echo "Restarting pods..."
kubectl rollout restart deployment tts-api
kubectl rollout restart deployment tts-worker
```

## 9. Anti-Patterns (DO NOT)

| Don't | Do Instead | Why |
|-------|-----------|-----|
| Use `enable.auto.commit = true` | Manual commit after processing | Auto-commit can mark unprocessed messages as done |
| Commit offset before processing | Commit after `process_tts` completes | Crash-before-commit enables at-least-once redelivery |
| Remove idempotency check from consumer | Keep `SELECT status WHERE id = $1` check | Consumer groups provide at-least-once, not exactly-once |
| Mount model PVC as read-write in API/Worker | Use `readOnly: true` in volumeMount | Prevents accidental model corruption by application |
| Create separate Docker images for API and Worker | Single image, different `command` | Same deps needed; one build simplifies CI |
| Use `auto.offset.reset = latest` | Use `earliest` | With consumer groups, `earliest` only applies to first-ever consumer start; ensures no messages missed |
| Keep `recover_pending_jobs` in consumer | Remove it | Consumer group offsets handle restart recovery; idempotency check handles duplicates |
| Run migrations from worker binary | Run from both API and worker | Both may start simultaneously; sqlx migrations are idempotent and handle concurrent runs |
| Set `replicas` in worker Deployment | Omit it; let KEDA manage | Setting replicas conflicts with KEDA autoscaling |

## 10. Test Cases

### Unit Tests
| ID | Component | Input | Expected | Edge Case |
|----|-----------|-------|----------|-----------|
| TC-001 | KafkaProducer::produce_tts_job | Valid TtsJobMessage | Produces to topic without error | Empty text_base64 |
| TC-002 | TtsJobMessage serde | JSON string | Correct deserialization | Missing optional field (input_filename) |
| TC-003 | Worker health endpoint | GET /health | 200 "OK" | — |

### Integration Tests
| ID | Flow | Setup | Verification | Teardown |
|----|------|-------|--------------|----------|
| IT-001 | API → Kafka → Worker | Start both, submit /generate | Job status reaches `completed` | Delete job from DB |
| IT-002 | Worker crash recovery | Kill worker mid-job, restart | Message redelivered, job completes | — |
| IT-003 | Multi-worker | 2 workers, 5 jobs | All jobs complete, no duplicates | Check DB for double processing |
| IT-004 | KEDA scaling | Produce 10 messages | Worker replicas increase | Wait for scale-down |

## 11. Error Handling Matrix

| Error | Detection | Response | Fallback | Logging |
|-------|-----------|----------|----------|---------|
| Kafka broker unreachable (producer) | Connection error on produce | Return 503 to client | If KAFKA_BROKERS unset: spawn_blocking fallback | ERROR |
| Kafka broker unreachable (consumer) | StreamConsumer error | Retry with backoff (rdkafka handles internally) | — | ERROR |
| Consumer group rebalance | rdkafka rebalance callback | Log partition assignments | — | INFO |
| process_tts panic | spawn_blocking JoinError | Set job status = error, commit offset | — | ERROR |
| Duplicate message delivery | Idempotency check (status ≠ pending) | Skip, commit offset | — | DEBUG |
| Model PVC not mounted | File not found on model path | Worker exits with error (CrashLoopBackOff) | — | ERROR |
| Model download Job fails | Job pod fails | build.sh exits with error | Manual re-run | ERROR |
| DB connection lost | sqlx error | Consumer continues; rdkafka will retry | — | ERROR |

## 12. Tansu Consumer Group Compatibility

### Status: Supported (single-broker)

Tansu implements all 6 consumer group APIs:
- JoinGroup, SyncGroup, Heartbeat, LeaveGroup (`tansu-broker/src/broker/group/`)
- OffsetCommit, OffsetFetch (`tansu-broker/src/broker/group/offset_commit.rs`, `offset_fetch.rs`)

### Known Issues

| Issue | Status | Impact |
|-------|--------|--------|
| rdkafka protocol parse errors (#62) | Fixed in tansu v0.1.0 | Was: Fetch response parse failures. Now resolved. |
| OffsetCommit `retention_time_ms = -1` (#447) | Fixed in tansu v0.5.2 | Was: `UnknownMemberIdError` on offset commit. Now resolved. |
| Multi-broker consumer groups (PostgreSQL) | Not suitable | Not applicable — we run single-broker. |
| KIP-848 new consumer protocol | Not implemented | Not applicable — rdkafka uses classic protocol. |
| ListGroups/DescribeGroups admin APIs | Partially implemented (#136) | Only affects admin tooling, not consumer operation. |

### Risk Mitigation

rdkafka + tansu consumer groups are less battle-tested than Python clients (aiokafka). Mitigations:

1. **Idempotency check retained** — even if offset commit misbehaves, duplicate processing is prevented by DB status check
2. **Manual offset commit** — avoids reliance on auto-commit timing
3. **Fallback path** — API retains `spawn_blocking` fallback when `KAFKA_BROKERS` is unset, enabling testing without Kafka
4. **Smoke test in build.sh** — after deployment, verify a test job flows through the pipeline

### Verified Tansu Version

Current deployment: `ghcr.io/tansu-io/tansu:latest`. Ensure version is ≥ v0.5.2 for offset commit fix.

## 13. References

| Topic | Location |
|-------|----------|
| Current TTS service | `text-to-speech/src/` |
| rdkafka docs | crates.io/crates/rdkafka |
| KEDA Kafka scaler | keda.sh/docs/scalers/apache-kafka/ |
| Tansu broker | `tansu/k8s/deployment.yaml` |
| Tansu consumer group issues | github.com/tansu-io/tansu/issues/62, #447 |
| Current Dockerfile | `text-to-speech/Dockerfile` |
| DB schema | `text-to-speech/migrations/` |
| Spec files (k8s) | `text-to-speech/k8s/` |
| Spec files (Docker) | `text-to-speech/Dockerfile` |
| Spec files (Cargo) | `text-to-speech/Cargo.toml` |
