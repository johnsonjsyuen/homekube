mod auth;
mod cleanup;
mod handlers;
mod inference;
mod phonemizer;
mod state;
mod ws_handler;

use state::{AppState, JwksCache};

use axum::{
    Router, middleware,
    routing::{get, post},
};
use sqlx::postgres::PgPoolOptions;
use std::sync::Arc;
use tokio::sync::RwLock;

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt::init();

    let database_url = std::env::var("DATABASE_URL").expect("DATABASE_URL must be set");
    let storage_path = std::env::var("STORAGE_PATH").unwrap_or_else(|_| "/app/storage".to_string());
    let keycloak_url = std::env::var("KEYCLOAK_URL")
        .unwrap_or_else(|_| "http://keycloak.keycloak.svc.cluster.local".to_string());
    let keycloak_realm = std::env::var("KEYCLOAK_REALM").unwrap_or_else(|_| "homekube".to_string());
    let keycloak_audience =
        std::env::var("KEYCLOAK_AUDIENCE").unwrap_or_else(|_| "tts".to_string());

    // Ensure storage directory exists
    tokio::fs::create_dir_all(&storage_path).await.unwrap();

    // Load Kokoro ONNX model for live TTS (optional - may not exist in test mode)
    let kokoro_model =
        match inference::KokoroModel::load("/app/kokoro-v1.0.onnx", "/app/voices-v1.0.bin") {
            Ok(model) => {
                tracing::info!("Kokoro TTS model loaded successfully");
                Some(model)
            }
            Err(e) => {
                tracing::warn!("Failed to load Kokoro model (live TTS disabled): {}", e);
                None
            }
        };

    let pool = PgPoolOptions::new()
        .max_connections(5)
        .connect(&database_url)
        .await
        .expect("Failed to connect to Postgres");

    // Run database migrations
    sqlx::migrate!()
        .run(&pool)
        .await
        .expect("Failed to run migrations");

    let state = AppState {
        pool: pool.clone(),
        storage_path,
        jwks_cache: Arc::new(RwLock::new(JwksCache::default())),
        keycloak_url,
        keycloak_realm,
        keycloak_audience,
        kokoro_model,
    };

    // Spawn cleanup task
    let cleanup_pool = pool.clone();
    let cleanup_storage = state.storage_path.clone();
    tokio::spawn(async move {
        // Run every hour
        let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(3600));
        loop {
            interval.tick().await;
            if let Err(e) = cleanup::run_cleanup(&cleanup_pool, &cleanup_storage).await {
                tracing::error!(error = %e, "Cleanup task failed");
            }
        }
    });

    // Routes requiring auth middleware
    let authed_routes = Router::new()
        .route("/generate", post(handlers::generate_speech))
        .route("/status/:id", get(handlers::check_status))
        .route("/jobs", get(handlers::list_jobs))
        .layer(middleware::from_fn_with_state(
            state.clone(),
            auth::auth_middleware,
        ));

    // WebSocket route - auth is handled via first message, not middleware
    let ws_routes = Router::new().route("/ws/live", get(ws_handler::ws_live_handler));

    let app = Router::new()
        .merge(authed_routes)
        .merge(ws_routes)
        .with_state(state);

    tracing::info!("Starting TTS server on 0.0.0.0:3000");
    let listener = tokio::net::TcpListener::bind("0.0.0.0:3000").await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
