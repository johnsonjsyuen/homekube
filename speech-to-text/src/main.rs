mod auth;
mod state;
mod transcribe;

use state::{AppState, JwksCache};

use axum::{Router, routing::get};
use std::sync::Arc;
use tokio::sync::RwLock;
use tower_http::cors::{Any, CorsLayer};

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt::init();

    let keycloak_url = std::env::var("KEYCLOAK_URL")
        .unwrap_or_else(|_| "http://keycloak.keycloak.svc.cluster.local".to_string());
    let keycloak_realm = std::env::var("KEYCLOAK_REALM").unwrap_or_else(|_| "homekube".to_string());
    let keycloak_audience =
        std::env::var("KEYCLOAK_AUDIENCE").unwrap_or_else(|_| "stt".to_string());
    let vllm_url = std::env::var("VLLM_URL")
        .unwrap_or_else(|_| "http://localhost:8000".to_string());

    let state = AppState {
        jwks_cache: Arc::new(RwLock::new(JwksCache::default())),
        keycloak_url,
        keycloak_realm,
        keycloak_audience,
        vllm_url,
    };

    // CORS configuration for WebSocket
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let app = Router::new()
        .route("/transcribe", get(transcribe::ws_handler))
        .route("/health", get(health_check))
        .layer(cors)
        .with_state(state);

    tracing::info!("Starting Speech-to-Text server on 0.0.0.0:3000");
    let listener = tokio::net::TcpListener::bind("0.0.0.0:3000").await.unwrap();
    axum::serve(listener, app).await.unwrap();
}

async fn health_check() -> &'static str {
    "OK"
}
