# Homekube Project - Coder Agent Memory

## Architecture Overview
- Kubernetes homelab with services in `temporal`, `default`, `keycloak` namespaces
- Docker images pushed to `localhost:5000` registry
- Build pattern: `build.sh` -> docker build -> push -> kubectl apply -> rollout restart
- Shared infra: Keycloak OIDC, CNPG PostgreSQL, Temporal workflows, Kafka (Tansu)

## web-scraper-kt / workflows-worker (Quarkus Kotlin)
- **Service name**: `workflows-worker` (merged web-scraper + news-worker)
- Package: `com.homekube.worker`, port 3000, namespace `temporal`
- Database: `workflows_worker`, task queue: `workflows-worker-queue`
- DB access: **jOOQ** (not Hibernate ORM Panache)
- Image: `localhost:5000/workflows-worker:latest`
- Temporal: Quarkiverse Temporal extension
- SmallRye Kafka `Emitter<Record<String, String>>` for keyed messages on `digests` topic
- Quarkus allOpen plugin for: @Path, @ApplicationScoped, @QuarkusTest
- Activity pattern: individual CDI beans -> bridge class -> Temporal worker
- Workflows: web scraper, daily news digest (ABC), economist digest

## Architecture: Speech-to-Text Pipeline
- Frontend: Svelte 5 runes ($state), WebAudio API sends base64 PCM16 over WebSocket
- Rust Backend: Axum WebSocket with VAD segmentation -> Python whisper HTTP POST
- Python Whisper: FastAPI + faster-whisper model

## Key Patterns
- Frontend uses Svelte 5 runes ($state) not stores
- Rust backend uses `serde_json::Value` for parsing incoming WebSocket messages
- Audio segments include overlap (~0.5s) for VAD-segmented chunks
