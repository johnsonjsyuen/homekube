mod auth;
mod chat;
mod claude;
mod db;
mod metrics;
mod nats_client;

use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::{get, post};
use axum::{Json, Router};
use axum_prometheus::PrometheusMetricLayer;
use claude::ClaudeError;
use metrics::{
    CLAUDE_CONCURRENT_REQUESTS, CLAUDE_PROMPT_CHARS_TOTAL, CLAUDE_REQUESTS_TOTAL,
    CLAUDE_REQUEST_DURATION_SECONDS,
};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::Semaphore;
use tower_http::cors::{Any, CorsLayer};

use crate::auth::JwksCache;
use crate::nats_client::NatsClient;

// ---------------------------------------------------------------------------
// Application state
// ---------------------------------------------------------------------------

pub struct AppState {
    semaphore: Semaphore,
    pool: PgPool,
    nats: Option<NatsClient>,
    jwks: JwksCache,
}

// ---------------------------------------------------------------------------
// Request / response types
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct AnalyzeRequest {
    prompt: Option<String>,
    output_format: Option<String>,
    timeout_seconds: Option<u32>,
}

#[derive(Serialize)]
struct AnalyzeResponse {
    response: String,
    duration_ms: u64,
}

#[derive(Serialize)]
struct HealthResponse {
    status: &'static str,
    claude_available: bool,
}

#[derive(Serialize)]
struct ErrorResponse {
    error: String,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn error_json(status: StatusCode, message: impl Into<String>) -> (StatusCode, Json<ErrorResponse>) {
    (
        status,
        Json(ErrorResponse {
            error: message.into(),
        }),
    )
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async fn analyze(
    state: axum::extract::State<Arc<AppState>>,
    Json(req): Json<AnalyzeRequest>,
) -> impl IntoResponse {
    // --- Validate prompt ---
    let prompt = match &req.prompt {
        Some(p) if !p.is_empty() => p,
        _ => return error_json(StatusCode::BAD_REQUEST, "prompt is required").into_response(),
    };

    if prompt.chars().count() > 100_000 {
        return error_json(
            StatusCode::BAD_REQUEST,
            "prompt exceeds 100000 character limit",
        )
        .into_response();
    }

    // --- Validate output_format ---
    let output_format = req.output_format.as_deref().unwrap_or("text");
    if output_format != "text" && output_format != "json" {
        return error_json(
            StatusCode::BAD_REQUEST,
            "invalid output_format, must be 'text' or 'json'",
        )
        .into_response();
    }

    // --- Validate timeout ---
    let timeout_secs = req.timeout_seconds.unwrap_or(120);
    if timeout_secs < 10 || timeout_secs > 300 {
        return error_json(
            StatusCode::BAD_REQUEST,
            "timeout_seconds must be between 10 and 300",
        )
        .into_response();
    }
    let timeout = Duration::from_secs(timeout_secs as u64);

    // --- Log (truncated) ---
    let preview: String = prompt.chars().take(100).collect();
    tracing::info!(
        prompt_len = prompt.len(),
        output_format,
        timeout_secs,
        "analyze request: {}...",
        preview,
    );

    // --- Record prompt size metric ---
    ::metrics::counter!(CLAUDE_PROMPT_CHARS_TOTAL).increment(prompt.len() as u64);

    // --- Acquire semaphore permit ---
    let _permit = state.semaphore.acquire().await.expect("semaphore closed");
    ::metrics::gauge!(CLAUDE_CONCURRENT_REQUESTS).increment(1.0);

    let start = Instant::now();
    let result = claude::invoke_claude(prompt, output_format, timeout).await;
    let duration = start.elapsed();

    ::metrics::gauge!(CLAUDE_CONCURRENT_REQUESTS).decrement(1.0);
    ::metrics::histogram!(CLAUDE_REQUEST_DURATION_SECONDS).record(duration.as_secs_f64());

    match result {
        Ok(response) => {
            ::metrics::counter!(CLAUDE_REQUESTS_TOTAL, "status" => "success").increment(1);
            tracing::info!(duration_ms = duration.as_millis() as u64, "analyze success");
            (
                StatusCode::OK,
                Json(AnalyzeResponse {
                    response,
                    duration_ms: duration.as_millis() as u64,
                }),
            )
                .into_response()
        }
        Err(e) => match e {
            ClaudeError::Timeout => {
                ::metrics::counter!(CLAUDE_REQUESTS_TOTAL, "status" => "timeout").increment(1);
                tracing::warn!(timeout_secs, "claude timed out");
                error_json(
                    StatusCode::REQUEST_TIMEOUT,
                    format!("claude timed out after {timeout_secs}s"),
                )
                .into_response()
            }
            ClaudeError::NotFound(_) => {
                ::metrics::counter!(CLAUDE_REQUESTS_TOTAL, "status" => "error").increment(1);
                tracing::error!("claude command not found");
                error_json(StatusCode::SERVICE_UNAVAILABLE, "claude command not found")
                    .into_response()
            }
            ClaudeError::ProcessFailed(ref msg) => {
                ::metrics::counter!(CLAUDE_REQUESTS_TOTAL, "status" => "error").increment(1);
                tracing::error!(error = %e, "claude process failed");
                error_json(StatusCode::BAD_GATEWAY, format!("claude process failed: {msg}"))
                    .into_response()
            }
            ClaudeError::IoError(ref msg) => {
                ::metrics::counter!(CLAUDE_REQUESTS_TOTAL, "status" => "error").increment(1);
                tracing::error!(error = %e, "claude io error");
                error_json(StatusCode::BAD_GATEWAY, format!("io error: {msg}")).into_response()
            }
        },
    }
}

async fn health() -> Json<HealthResponse> {
    let available = claude::check_available().await;
    Json(HealthResponse {
        status: "ok",
        claude_available: available,
    })
}

async fn ready() -> impl IntoResponse {
    if claude::check_available().await {
        (
            StatusCode::OK,
            Json(HealthResponse {
                status: "ok",
                claude_available: true,
            }),
        )
            .into_response()
    } else {
        (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(HealthResponse {
                status: "ok",
                claude_available: false,
            }),
        )
            .into_response()
    }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt::init();

    let port: u16 = std::env::var("PORT")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(3000);

    let max_concurrent: usize = std::env::var("MAX_CONCURRENT")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(3);

    // --- Database ---
    let database_url = std::env::var("DATABASE_URL")
        .expect("DATABASE_URL must be set");
    let pool = PgPool::connect(&database_url)
        .await
        .expect("failed to connect to database");

    // Run migrations.
    sqlx::migrate!("./migrations")
        .run(&pool as &PgPool)
        .await
        .expect("failed to run database migrations");
    tracing::info!("database migrations applied");

    // --- NATS (optional) ---
    let nats = match std::env::var("NATS_URL") {
        Ok(nats_url) => match NatsClient::connect(&nats_url).await {
            Ok(client) => {
                tracing::info!(url = %nats_url, "connected to NATS");
                Some(client)
            }
            Err(e) => {
                tracing::warn!(error = %e, "failed to connect to NATS — continuing without it");
                None
            }
        },
        Err(_) => {
            tracing::warn!("NATS_URL not set — NATS integration disabled");
            None
        }
    };

    // --- JWKS ---
    let jwks = JwksCache::new()
        .await
        .expect("failed to fetch JWKS keys from Keycloak");
    tracing::info!("JWKS keys loaded");

    let state = Arc::new(AppState {
        semaphore: Semaphore::new(max_concurrent),
        pool,
        nats,
        jwks,
    });

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let (prometheus_layer, metric_handle) = PrometheusMetricLayer::pair();

    let app = Router::new()
        .route("/api/analyze", post(analyze))
        .route("/ws/chat", get(chat::ws_handler))
        .route("/health", get(health))
        .route("/ready", get(ready))
        .route("/metrics", get(|| async move { metric_handle.render() }))
        .layer(cors)
        .layer(prometheus_layer)
        .with_state(state);

    let addr = format!("0.0.0.0:{port}");
    tracing::info!("Starting claude-code-api on {addr} (max_concurrent={max_concurrent})");
    let listener = tokio::net::TcpListener::bind(&addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
