# Replace Tansu with NATS JetStream (Implementation)

## 1. Problem Statement

Tansu is a niche Kafka-compatible broker backed by PostgreSQL requiring:
- A dedicated CNPG PostgreSQL cluster (`tansu-db`) with ~542-line schema
- A PVC for schema registry storage
- A deployment script (`deploy.py`) that seeds SQL into the DB pod
- Manual schema maintenance for Kafka metadata tables

NATS JetStream eliminates all of this: built-in persistence, no external DB, single binary, battle-tested.

**Goal:** Replace Tansu with NATS JetStream while preserving identical message flows, autoscaling, and at-least-once delivery semantics.

## 2. Current Architecture

### Message Flows

| Stream | Subject | Producer | Consumer | Consumer Group | Client Library |
|--------|---------|----------|----------|----------------|----------------|
| TTS-JOBS | `tts.jobs` | text-to-speech API (Rust) | text-to-speech worker (Rust) | `tts-workers` | rdkafka |
| DIGESTS | `digests` | workflows-worker (Kotlin) | whatsapp (Node.js) | `whatsapp-relay` | SmallRye Kafka (KafkaJS under the hood) |

### Message Schemas (unchanged)

**tts.jobs:**
```json
{
  "jobId": "uuid",
  "username": "string",
  "textBase64": "base64-encoded text",
  "voice": "string",
  "speed": "string",
  "inputFilename": "optional string",
  "timestamp": "ISO 8601 string"
}
```

**digests:**
```json
{
  "userId": "string",
  "recipientPhone": "string",
  "message": "string",
  "workflow": "string",
  "timestamp": "ISO 8601 string"
}
```

## 3. Target Architecture

### NATS JetStream Server

- **Image:** `nats:2.10-alpine`
- **Config:** JetStream enabled with file-based storage on a PVC
- **Port:** 4222 (client), 8222 (monitoring)
- **Namespace:** `default`
- **Service DNS:** `nats.default.svc.cluster.local:4222`
- **Storage:** 1Gi PVC mounted at `/data/jetstream`
- **Resources:** 50m/64Mi request, 250m/256Mi limit (lighter than Tansu+CNPG combined)

### JetStream Streams (replaces Kafka topics)

| Stream Name | Subjects | Retention | Max Age | Replicas | Storage |
|-------------|----------|-----------|---------|----------|---------|
| `TTS_JOBS` | `tts.jobs` | WorkQueue | 7d | 1 | File |
| `DIGESTS` | `digests` | WorkQueue | 7d | 1 | File |

**WorkQueue retention** = message is removed after acknowledgement by any consumer in the group. This matches the Kafka consumer-group semantics used today.

### JetStream Consumers (replaces Kafka consumer groups)

| Consumer Name | Stream | Durable | Ack Policy | Ack Wait | Max Deliver | Filter |
|---------------|--------|---------|------------|----------|-------------|--------|
| `tts-workers` | `TTS_JOBS` | Yes | Explicit | 10m | 3 | `tts.jobs` |
| `whatsapp-relay` | `DIGESTS` | Yes | Explicit | 30s | 3 | `digests` |

- `tts-workers` ack wait = 10m because TTS processing is slow (matches current `max.poll.interval.ms=600000`)
- `whatsapp-relay` ack wait = 30s (WhatsApp delivery is fast)
- Max deliver = 3 retries before message is dropped (homelab, no DLQ needed)

## 4. Client Library Changes

### 4a. text-to-speech (Rust) — rdkafka → async-nats

**Cargo.toml change:**
```diff
- rdkafka = { version = "0.36", features = ["cmake-build"] }
+ async-nats = "0.38"
```

**Environment variable change:**
```diff
- KAFKA_BROKERS=tansu:9092
+ NATS_URL=nats://nats:4222
```

**Producer (`nats_producer.rs` replacing `kafka_producer.rs`):**
- `async_nats::connect(nats_url)` → get JetStream context → `jetstream.publish("tts.jobs", payload)`
- Publish returns ack from server (confirming persistence) — equivalent to `acks=all`
- Key (job_id) goes in NATS message header `Nats-Msg-Id` for deduplication

**Consumer (`nats_consumer.rs` replacing `kafka_consumer.rs`):**
- `jetstream.get_stream("TTS_JOBS")` → `stream.get_or_create_consumer("tts-workers", config)` → `consumer.messages()`
- Each message: process → `msg.ack().await` (explicit ack, equivalent to manual commit)
- On transient DB error: don't ack → NATS redelivers after ack_wait (10m)
- Idempotency check remains: `SELECT status FROM jobs WHERE id = $1`

### 4b. whatsapp (Node.js) — kafkajs → nats

**package.json change:**
```diff
- "kafkajs": "^2.2"
+ "nats": "^2.28"
```

**Environment variable change:**
```diff
- KAFKA_BROKERS=tansu:9092
+ NATS_URL=nats://nats:4222
```

**Consumer (`nats-consumer.ts` replacing `kafka-consumer.ts`):**
- `connect({ servers: natsUrl })` → `nc.jetstream()` → `js.consumers.get("DIGESTS", "whatsapp-relay")` → `consumer.consume()`
- Each message: parse JSON payload → deliver via WhatsApp → `msg.ack()`
- On failure: log error, ack anyway (current behavior: no DLQ for homelab)

### 4c. workflows-worker (Kotlin/Quarkus) — SmallRye Kafka → quarkus-messaging-nats

**build.gradle.kts change:**
```diff
- implementation("io.quarkus:quarkus-messaging-kafka")
+ implementation("io.nats:jnats:2.20.5")
```

**application.properties change:**
```diff
- mp.messaging.outgoing.digests.connector=smallrye-kafka
- mp.messaging.outgoing.digests.topic=digests
- mp.messaging.outgoing.digests.bootstrap.servers=${KAFKA_BROKERS:tansu.default.svc.cluster.local:9092}
- mp.messaging.outgoing.digests.value.serializer=org.apache.kafka.common.serialization.StringSerializer
- mp.messaging.outgoing.digests.key.serializer=org.apache.kafka.common.serialization.StringSerializer
+ nats.url=${NATS_URL:nats://nats.default.svc.cluster.local:4222}
```

**SendNotificationActivity.kt change:**
- Remove SmallRye Kafka `Emitter<Record<String, String>>` and `@Channel` injection
- Inject a new `NatsPublisher` CDI bean that wraps jnats `Connection` + JetStream
- `NatsPublisher.publish("digests", messageValue)` — publishes to JetStream subject
- Message key (userId) is already part of the JSON payload, no separate key needed

## 5. KEDA Autoscaling

KEDA has a built-in NATS JetStream scaler (`nats-jetstream`).

**keda-scaledobject.yaml change:**
```diff
  triggers:
- - type: kafka
+ - type: nats-jetstream
    metadata:
-     bootstrapServers: tansu.default.svc.cluster.local:9092
-     consumerGroup: tts-workers
-     topic: tts-jobs
-     lagThreshold: "2"
-     offsetResetPolicy: earliest
+     natsServerMonitoringEndpoint: "nats.default.svc.cluster.local:8222"
+     account: "$G"
+     stream: "TTS_JOBS"
+     consumer: "tts-workers"
+     lagThreshold: "2"
```

## 6. Kubernetes Manifests

### What Gets Deleted (tansu/)

| File | Description |
|------|-------------|
| `tansu/k8s/deployment.yaml` | Tansu broker pod |
| `tansu/k8s/db.yaml` | CNPG PostgreSQL cluster |
| `tansu/k8s/service.yaml` | ClusterIP service |
| `tansu/k8s/pvc.yaml` | Schema registry PVC |
| `tansu/k8s/service-temporal.yaml` | ExternalName for temporal namespace |
| `tansu/sql/schema.sql` | 542-line Kafka metadata schema |
| `tansu/sql/grant.sql` | DB grants |
| `tansu/deploy.py` | Init script |

### What Gets Created (nats/k8s/)

**nats-config.yaml** — ConfigMap with NATS server config:
```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: nats-config
data:
  nats.conf: |
    listen: 0.0.0.0:4222
    http_port: 8222
    jetstream {
      store_dir: /data/jetstream
      max_mem: 128M
      max_file: 1G
    }
```

**pvc.yaml** — 1Gi PVC for JetStream file storage

**deployment.yaml** — Single-replica NATS deployment:
- Image: `nats:2.10-alpine`
- Args: `["-c", "/etc/nats/nats.conf"]`
- Ports: 4222 (client), 8222 (monitoring)
- Mount: ConfigMap at `/etc/nats`, PVC at `/data/jetstream`
- Health: HTTP GET `/healthz` on port 8222
- Resources: 50m/64Mi request, 250m/256Mi limit

**service.yaml** — ClusterIP exposing ports 4222 + 8222

**service-temporal.yaml** — ExternalName pointing `nats` in temporal namespace to `nats.default.svc.cluster.local`

**init-streams.yaml** — Job (or init container) using `natsio/nats-box` to create streams+consumers:
```sh
nats stream add TTS_JOBS --subjects="tts.jobs" --retention=work --storage=file --max-age=7d --replicas=1 --defaults
nats stream add DIGESTS --subjects="digests" --retention=work --storage=file --max-age=7d --replicas=1 --defaults
nats consumer add TTS_JOBS tts-workers --ack=explicit --wait=10m --max-deliver=3 --deliver=all --replay=instant --defaults
nats consumer add DIGESTS whatsapp-relay --ack=explicit --wait=30s --max-deliver=3 --deliver=all --replay=instant --defaults
```

## 7. Resource Comparison

| Component | Tansu (current) | NATS JetStream (target) |
|-----------|----------------|------------------------|
| Broker | 100m/128Mi req, 500m/512Mi limit | 50m/64Mi req, 250m/256Mi limit |
| Database | CNPG: 50m/64Mi req, 500m/256Mi limit | None |
| PVC | 1Gi (schema) + 1Gi (CNPG data) = 2Gi | 1Gi (JetStream data) |
| Pods | 2 (broker + DB) | 1 |
| **Total CPU request** | **150m** | **50m** |
| **Total RAM request** | **192Mi** | **64Mi** |

## 8. Migration Order

Single cutover (no users, no gradual migration needed):

1. Deploy NATS JetStream (nats/k8s/) + create streams/consumers
2. Update all three services simultaneously (text-to-speech, whatsapp, workflows-worker)
3. Delete Tansu resources and `tansu/` directory

## 9. ANTI-PATTERNS (DO NOT)

| # | Don't | Do Instead | Why |
|---|-------|-----------|-----|
| 1 | Use NATS core pub/sub without JetStream | Always use JetStream for persistent messaging | Core NATS is fire-and-forget, no persistence or replay |
| 2 | Use Interest retention policy | Use WorkQueue retention | Interest keeps messages until all consumers ack; WorkQueue removes after first ack — matches Kafka consumer group semantics |
| 3 | Create streams/consumers from application code | Use init Job or `nats` CLI in deploy script | Avoids race conditions when multiple pods start simultaneously |
| 4 | Use auto-ack in consumers | Use explicit ack | Must not ack before processing completes (at-least-once) |
| 5 | Put the NATS monitoring port (8222) in a public ingress | Only expose 8222 within cluster for KEDA | Monitoring endpoint has no auth |
| 6 | Use `max_deliver=-1` (unlimited) | Use `max_deliver=3` | Poison messages would loop forever in homelab |
| 7 | Rely on NATS message deduplication window alone for idempotency | Keep DB-level idempotency checks | Dedup window is time-limited (2min default); DB check is permanent |

## 10. TEST CASE SPECIFICATIONS

### Unit Tests

| Test ID | Component | Input | Expected Output | Edge Cases |
|---------|-----------|-------|-----------------|------------|
| TC-001 | TTS NATS producer | TtsJobMessage | Published to `tts.jobs`, server ack received | NATS down → error returned |
| TC-002 | TTS NATS consumer | Message on `tts.jobs` | Job processed, message acked | Duplicate message (idempotency check) |
| TC-003 | TTS NATS consumer | Transient DB error during processing | Message NOT acked, redelivered | DB recovers → processes on retry |
| TC-004 | WhatsApp NATS consumer | Message on `digests` | WhatsApp message sent, acked | Malformed JSON → ack anyway (no DLQ) |
| TC-005 | Workflows NATS producer | SendNotificationInput | Published to `digests` subject | NATS down → exception propagated to Temporal |

### Integration Tests

| Test ID | Flow | Setup | Verification | Teardown |
|---------|------|-------|--------------|----------|
| IT-001 | TTS end-to-end | Submit TTS job via API | Worker processes job, DB status = completed | Delete test job |
| IT-002 | Digest end-to-end | Produce to `digests` via `nats pub` | WhatsApp consumer logs delivery | N/A |
| IT-003 | KEDA scaling | Publish 5 messages to `tts.jobs` | Worker replicas scale up from 0 | Wait for cooldown, verify scale-down |

## 11. ERROR HANDLING MATRIX

| Error Type | Detection | Response | Fallback | Logging |
|------------|-----------|----------|----------|---------|
| NATS connection refused | Connect timeout | Retry with backoff (built into async-nats) | Pod restarts via liveness probe | ERROR |
| Publish rejected (stream full) | Publish returns error | Return 503 to API caller | None — 1Gi is very large for homelab | ERROR + alert |
| Consumer ack timeout (10m) | NATS redelivers | Worker re-processes (idempotency check skips if done) | Max 3 redeliveries | WARN on redeliver |
| Poison message | Max deliver exceeded | Message dropped (no DLQ) | Manual inspection via `nats stream view` | ERROR |
| JetStream storage full | Publish error / health check | Old messages evicted by max-age (7d) | Increase PVC if recurring | ERROR + alert |

## 12. REFERENCES

| Topic | Location |
|-------|----------|
| NATS JetStream docs | https://docs.nats.io/nats-concepts/jetstream |
| async-nats (Rust) | https://crates.io/crates/async-nats |
| nats (Node.js) | https://www.npmjs.com/package/nats |
| quarkus-messaging-nats | https://docs.quarkiverse.io/quarkus-messaging-nats/dev/ |
| KEDA NATS JetStream scaler | https://keda.sh/docs/latest/scalers/nats-jetstream/ |
| Current TTS Kafka producer | text-to-speech/src/kafka_producer.rs |
| Current TTS Kafka consumer | text-to-speech/src/kafka_consumer.rs |
| Current WhatsApp consumer | whatsapp/src/kafka-consumer.ts |
| Current workflows producer | workflows-worker/src/main/kotlin/.../SendNotificationActivity.kt |
| Current workflows Kafka config | workflows-worker/src/main/resources/application.properties:31-35 |
| Current KEDA config | text-to-speech/k8s/keda-scaledobject.yaml |
