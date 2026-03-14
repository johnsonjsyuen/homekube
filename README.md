# homekube

A self-hosted Kubernetes homelab running multiple services including a homepage, WhatsApp integration, text-to-speech, speech-to-text, Claude Code, and workflow automation.

## Prerequisites

Before running `build_all.sh`, ensure the following are installed and configured:

### Required on the host

- **Docker** - all services are built as Docker images targeting `linux/amd64`
- **kubectl** - configured with access to your Kubernetes cluster
- **A running Kubernetes cluster** - services deploy to the `default` and `temporal` namespaces

### Local Docker registry

A local Docker registry must be running on `localhost:5000`. All images are pushed there.

Start it with:

```bash
./Docker\ registry/start_registry.sh
```

This runs a `registry:2` container on port 5000.

### In-cluster infrastructure

These must be running in the cluster before deploying services:

| Component | Used by |
|---|---|
| **Keycloak** (realm: `homekube`) | homepage, text-to-speech, speech-to-text, whatsapp, workflows-worker |
| **PostgreSQL** (CloudNativePG) | text-to-speech, whatsapp, workflows-worker, speedtest |
| **NATS JetStream** (`nats:4222`) | text-to-speech, whatsapp, workflows-worker |
| **Temporal** (`temporal-frontend:7233`) | workflows-worker |

### Kubernetes secrets

- `anthropic-api-key` - required by `claude-code` and `claude-code-api` (contains `ANTHROPIC_API_KEY`)
- Keycloak client secrets - required by `workflows-worker`

## Building and deploying

Build all services in parallel, push images to the local registry, apply k8s manifests, and restart deployments:

```bash
./build_all.sh
```

This builds the following services concurrently:

| Service | Stack | Description |
|---|---|---|
| **homepage** | SvelteKit / Node.js 22 | Web frontend |
| **text-to-speech** | Rust + Python (Kokoro TTS) | TTS API with ONNX model |
| **speech-to-text** | Rust proxy + Python (Whisper) | STT via faster-whisper large-v3-turbo |
| **whatsapp** | TypeScript / Node.js 22 | WhatsApp messaging integration |
| **claude-code** | Node.js 22 / claude-code CLI | Interactive Claude Code sandbox pod |
| **claude-code-api** | Rust + Node.js 22 / claude-code CLI | HTTP API wrapping Claude Code |
| **workflows-worker** | Kotlin / Quarkus (GraalVM native) | Temporal workflow worker |

Each service's `build.sh` runs `docker build`, `docker push` to `localhost:5000`, `kubectl apply`, and `kubectl rollout restart`.

### Building a single service

```bash
cd <service-name>
./build.sh
```

## Notes

- The `speech-to-text` service builds two images: a Rust WebSocket proxy and a Python Whisper sidecar that run together in one pod.
- The `text-to-speech` build downloads the Kokoro ONNX model from GitHub (~large download on first build).
- The `speech-to-text` Whisper build downloads the large-v3-turbo model from HuggingFace (~1.5 GB on first build).
- The `workflows-worker` deploys to the `temporal` namespace; all other services deploy to `default`.
- All build toolchains (Rust, Node.js, Python, GraalVM) run inside Docker - no language runtimes are needed on the host.
