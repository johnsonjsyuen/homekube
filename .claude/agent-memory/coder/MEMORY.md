# Homekube Project - Coder Agent Memory

## Architecture Overview
- Kubernetes homelab with services in `temporal`, `default`, `keycloak` namespaces
- Docker images pushed to `localhost:5000` registry
- Build pattern: `build.sh` -> docker build -> push -> kubectl apply -> rollout restart
- Shared infra: Keycloak OIDC, CNPG PostgreSQL, Temporal workflows, Kafka (Tansu)

## web-scraper-kt (Quarkus Kotlin)
- Package: `com.homekube.webscraper`, port 3000, namespace `temporal`
- Temporal SDK 1.27.0: `ScheduleClient.newInstance(WorkflowServiceStubs)` (not from WorkflowClient)
- SmallRye Kafka `Emitter<Record<String, String>>` for keyed messages on `digests` topic
- Quarkus allOpen plugin for: @Path, @ApplicationScoped, @Entity, @QuarkusTest
- JPA data classes need default values; `@JdbcTypeCode(SqlTypes.ARRAY)` for text[] columns
- Activity pattern: individual CDI beans -> bridge class (ScraperActivitiesImpl) -> Temporal worker

## Architecture: Speech-to-Text Pipeline
- Frontend: Svelte 5 runes ($state), WebAudio API sends base64 PCM16 over WebSocket
- Rust Backend: Axum WebSocket with VAD segmentation -> Python whisper HTTP POST
- Python Whisper: FastAPI + faster-whisper model

## Key Patterns
- Frontend uses Svelte 5 runes ($state) not stores
- Rust backend uses `serde_json::Value` for parsing incoming WebSocket messages
- Audio segments include overlap (~0.5s) for VAD-segmented chunks
