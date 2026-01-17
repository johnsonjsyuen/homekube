use axum::{
    extract::State,
    http::StatusCode,
    response::Json,
    routing::get,
    Router,
};
use serde::Serialize;
use chrono::{DateTime, Utc};
use std::sync::Arc;
use crate::db::Db;

#[derive(Serialize, sqlx::FromRow)]
pub struct SpeedtestResultResponse {
    pub timestamp: DateTime<Utc>,
    pub server_name: String,
    pub server_country: String,
    pub latency_ms: f32,
    pub download_bandwidth: i32,
    pub upload_bandwidth: i32,
}

pub fn create_router(db: Arc<Db>) -> Router {
    Router::new()
        .route("/api/results", get(get_results))
        .with_state(db)
}

async fn get_results(
    State(db): State<Arc<Db>>,
) -> Result<Json<Vec<SpeedtestResultResponse>>, StatusCode> {
    match db.get_recent_results().await {
        Ok(results) => Ok(Json(results)),
        Err(e) => {
            log::error!("Failed to fetch results: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}
