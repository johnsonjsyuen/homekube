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
use std::collections::HashMap;
use crate::db::Db;

#[derive(Serialize, Clone)]
pub struct SpeedtestResultResponse {
    pub timestamp: DateTime<Utc>,
    pub server_name: String,
    pub server_country: String,
    pub latency_ms: f32,
    pub download_bandwidth: i32,
    pub upload_bandwidth: i32,
}

#[derive(Serialize)]
pub struct LocationSummary {
    pub latest: Option<SpeedtestResultResponse>,
    pub results: Vec<SpeedtestResultResponse>,
    pub avg_download: f64,
    pub avg_upload: f64,
    pub avg_latency: f64,
}

pub fn create_router(db: Arc<Db>) -> Router {
    Router::new()
        .route("/api/results", get(get_results))
        .route("/api/results/by-location", get(get_results_by_location))
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

async fn get_results_by_location(
    State(db): State<Arc<Db>>,
) -> Result<Json<HashMap<String, LocationSummary>>, StatusCode> {
    match db.get_recent_results().await {
        Ok(results) => {
            let mut grouped: HashMap<String, Vec<SpeedtestResultResponse>> = HashMap::new();
            
            for result in results {
                grouped
                    .entry(result.server_name.clone())
                    .or_insert_with(Vec::new)
                    .push(result);
            }
            
            let mut summaries: HashMap<String, LocationSummary> = HashMap::new();
            
            for (location, mut location_results) in grouped {
                // Sort by timestamp descending (newest first)
                location_results.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));
                
                let count = location_results.len() as f64;
                let avg_download = location_results.iter().map(|r| r.download_bandwidth as f64).sum::<f64>() / count;
                let avg_upload = location_results.iter().map(|r| r.upload_bandwidth as f64).sum::<f64>() / count;
                let avg_latency = location_results.iter().map(|r| r.latency_ms as f64).sum::<f64>() / count;
                
                summaries.insert(location, LocationSummary {
                    latest: location_results.first().cloned(),
                    results: location_results,
                    avg_download,
                    avg_upload,
                    avg_latency,
                });
            }
            
            Ok(Json(summaries))
        }
        Err(e) => {
            log::error!("Failed to fetch results: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}
