mod auth;
mod cleanup;
mod handlers;
mod state;

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

    let pool = PgPoolOptions::new()
        .max_connections(5)
        .connect(&database_url)
        .await
        .expect("Failed to connect to Postgres");

    // Initialize Schema
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS jobs (
            id UUID PRIMARY KEY,
            status TEXT NOT NULL, -- 'processing', 'completed', 'error'
            error_message TEXT,
            file_path TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            last_accessed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            username TEXT,
            voice TEXT,
            speed TEXT
        );
        "#,
    )
    .execute(&pool)
    .await
    .expect("Failed to create table");

    // Migration: Add new columns if they don't exist (for existing deployments)
    sqlx::query("ALTER TABLE jobs ADD COLUMN IF NOT EXISTS username TEXT")
        .execute(&pool)
        .await
        .ok(); // Ignore error if column already exists
    sqlx::query("ALTER TABLE jobs ADD COLUMN IF NOT EXISTS voice TEXT")
        .execute(&pool)
        .await
        .ok();
    sqlx::query("ALTER TABLE jobs ADD COLUMN IF NOT EXISTS speed TEXT")
        .execute(&pool)
        .await
        .ok();

    let state = AppState {
        pool: pool.clone(),
        storage_path,
        jwks_cache: Arc::new(RwLock::new(JwksCache::default())),
        keycloak_url,
        keycloak_realm,
        keycloak_audience,
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

    let app = Router::new()
        .route("/generate", post(handlers::generate_speech))
        .route("/status/:id", get(handlers::check_status))
        .route("/jobs", get(handlers::list_jobs))
        .layer(middleware::from_fn_with_state(
            state.clone(),
            auth::auth_middleware,
        ))
        .with_state(state);

    tracing::info!("Starting TTS server on 0.0.0.0:3000");
    let listener = tokio::net::TcpListener::bind("0.0.0.0:3000").await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
