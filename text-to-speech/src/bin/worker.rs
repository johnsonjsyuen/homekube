use text_to_speech::nats_consumer;

use axum::{Router, routing::get};
use axum_prometheus::PrometheusMetricLayer;
use sqlx::postgres::PgPoolOptions;

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt::init();

    let database_url = std::env::var("DATABASE_URL").expect("DATABASE_URL must be set");
    let storage_path = std::env::var("STORAGE_PATH").unwrap_or_else(|_| "/app/storage".to_string());
    let nats_url = std::env::var("NATS_URL").unwrap_or_else(|_| "nats://nats:4222".to_string());

    // Ensure storage directories exist
    tokio::fs::create_dir_all(&storage_path).await.unwrap();
    tokio::fs::create_dir_all(format!("{}/pending", storage_path))
        .await
        .unwrap();

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

    // Set up Prometheus metrics recorder so worker metrics are captured
    let (prometheus_layer, metric_handle) = PrometheusMetricLayer::pair();

    // Spawn health + metrics server on port 3001
    tokio::spawn(async move {
        let app = Router::new()
            .route("/health", get(|| async { "OK" }))
            .route("/metrics", get(|| async move { metric_handle.render() }))
            .layer(prometheus_layer);

        tracing::info!("Starting TTS worker health server on 0.0.0.0:3001");
        let listener = tokio::net::TcpListener::bind("0.0.0.0:3001").await.unwrap();
        axum::serve(listener, app).await.unwrap();
    });

    tracing::info!("Starting TTS worker consumer");

    // Consumer loop with automatic reconnection
    loop {
        match nats_consumer::run_consumer(
            nats_url.clone(),
            pool.clone(),
            storage_path.clone(),
        )
        .await
        {
            Ok(()) => {
                tracing::warn!("NATS consumer returned unexpectedly, restarting in 5s");
            }
            Err(e) => {
                tracing::error!(error = %e, "NATS consumer error, restarting in 5s");
            }
        }
        tokio::time::sleep(tokio::time::Duration::from_secs(5)).await;
    }
}
