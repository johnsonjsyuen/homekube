use axum::{
    extract::{Path, Multipart, State},
    response::{IntoResponse, Response, Json},
    routing::{get, post},
    Router,
    http::{StatusCode, header},
    body::Body,
};
use serde::Serialize;
use std::{sync::Arc, process::Command};
use uuid::Uuid;
use tempfile::Builder;
use std::io::Write;
use tokio::fs;
use sqlx::{postgres::PgPoolOptions, Pool, Postgres, Row};
use chrono::prelude::*;

#[derive(Clone)]
struct AppState {
    pool: Pool<Postgres>,
    storage_path: String,
}

#[derive(Serialize)]
#[serde(rename_all = "lowercase")]
enum JobStatusResponse {
    Processing,
    Completed,
    Error { message: String },
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt::init();

    let database_url = std::env::var("DATABASE_URL").expect("DATABASE_URL must be set");
    let storage_path = std::env::var("STORAGE_PATH").unwrap_or_else(|_| "/app/storage".to_string());

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
            last_accessed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        "#
    )
    .execute(&pool)
    .await
    .expect("Failed to create table");

    let state = AppState {
        pool: pool.clone(),
        storage_path,
    };

    // Spawn cleanup task
    let cleanup_pool = pool.clone();
    let cleanup_storage = state.storage_path.clone();
    tokio::spawn(async move {
        // Run every hour
        let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(3600));
        loop {
            interval.tick().await;
            if let Err(e) = run_cleanup(&cleanup_pool, &cleanup_storage).await {
                eprintln!("Cleanup failed: {}", e);
            }
        }
    });

    let app = Router::new()
        .route("/generate", post(generate_speech))
        .route("/status/:id", get(check_status))
        .with_state(state);

    println!("Listening on 0.0.0.0:3000");
    let listener = tokio::net::TcpListener::bind("0.0.0.0:3000").await.unwrap();
    axum::serve(listener, app).await.unwrap();
}

async fn run_cleanup(pool: &Pool<Postgres>, storage_path: &str) -> anyhow::Result<()> {
    println!("Running cleanup...");
    // Find jobs not accessed in the last 7 days
    let rows = sqlx::query(
        "DELETE FROM jobs WHERE last_accessed_at < NOW() - INTERVAL '7 days' RETURNING file_path"
    )
    .fetch_all(pool)
    .await?;

    for row in rows {
        let file_path: Option<String> = row.get("file_path");
        if let Some(path) = file_path {
            // Check if path is within storage_path to avoid any issues, though it should be.
            if path.starts_with(storage_path) {
                if let Err(e) = tokio::fs::remove_file(&path).await {
                    eprintln!("Failed to delete file {}: {}", path, e);
                } else {
                    println!("Deleted old file: {}", path);
                }
            }
        }
    }
    Ok(())
}

async fn generate_speech(
    State(state): State<AppState>,
    mut multipart: Multipart,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let mut text_content = None;
    let mut speed = "1.0".to_string();
    let mut voice = "af_heart".to_string();

    while let Some(field) = multipart.next_field().await.map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))? {
        let name = field.name().unwrap_or("").to_string();
        
        if name == "text_file" {
            let data = field.bytes().await.map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
            text_content = Some(data);
        } else if name == "speed" {
            let txt = field.text().await.map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?;
            speed = txt;
        } else if name == "voice" {
            let txt = field.text().await.map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?;
            voice = txt;
        }
    }

    let text_bytes = text_content.ok_or((StatusCode::BAD_REQUEST, "Missing text_file field".to_string()))?;
    
    if speed.parse::<f32>().is_err() {
        return Err((StatusCode::BAD_REQUEST, "Invalid speed parameter".to_string()));
    }

    let job_id = Uuid::new_v4();
    
    // Insert into DB
    sqlx::query("INSERT INTO jobs (id, status) VALUES ($1, 'processing')")
        .bind(job_id)
        .execute(&state.pool)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let pool = state.pool.clone();
    let storage_path = state.storage_path.clone();
    
    tokio::task::spawn_blocking(move || {
        let rt = tokio::runtime::Handle::current();
        if let Err(e) = process_tts(pool.clone(), job_id, text_bytes, speed, voice, storage_path, &rt) {
             rt.block_on(async {
                let _ = sqlx::query("UPDATE jobs SET status = 'error', error_message = $1 WHERE id = $2")
                    .bind(e)
                    .bind(job_id)
                    .execute(&pool)
                    .await;
             });
        }
    });

    Ok(Json(serde_json::json!({ "id": job_id.to_string() })))
}

fn process_tts(
    pool: Pool<Postgres>,
    job_id: Uuid,
    text_bytes: axum::body::Bytes,
    speed: String,
    voice: String,
    storage_path: String,
    rt: &tokio::runtime::Handle,
) -> Result<(), String> {
    // 1. Write text content to a temp file
    let mut text_file = Builder::new()
        .suffix(".txt")
        .tempfile()
        .map_err(|e| format!("Failed to create temp text file: {}", e))?;
    text_file.write_all(&text_bytes).map_err(|e| format!("Failed to write text file: {}", e))?;
    let text_path = text_file.path().to_str().ok_or("Invalid path")?.to_string();

    let output_dir = std::path::Path::new(&storage_path);
    // wav intermediate in temp, mp3 result in persistent storage
    let wav_path = format!("/tmp/{}.wav", job_id); 
    let mp3_filename = format!("{}.mp3", job_id);
    let mp3_path = output_dir.join(&mp3_filename);

    let status = Command::new("kokoro-tts")
        .arg(&text_path)
        .arg(&wav_path)
        .arg("--voice")
        .arg(&voice)
        .arg("--speed")
        .arg(&speed)
        .status()
        .map_err(|e| format!("Failed to execute kokoro-tts: {}", e))?;

    if !status.success() {
        return Err("kokoro-tts failed execution".to_string());
    }

    let ffmpeg_status = Command::new("ffmpeg")
        .arg("-i")
        .arg(&wav_path)
        .arg("-b:a")
        .arg("192k") 
        .arg("-y")   
        .arg(mp3_path.to_str().unwrap())
        .output()
        .map_err(|e| format!("Failed to execute ffmpeg: {}", e))?;

    if !ffmpeg_status.status.success() {
        let stderr = String::from_utf8_lossy(&ffmpeg_status.stderr);
        return Err(format!("ffmpeg failed: {}", stderr));
    }

    // Cleanup wav file
    let _ = std::fs::remove_file(wav_path);

    // Update DB
    rt.block_on(async {
        let _ = sqlx::query("UPDATE jobs SET status = 'completed', file_path = $1 WHERE id = $2")
            .bind(mp3_path.to_str().unwrap())
            .bind(job_id)
            .execute(&pool)
            .await;
    });

    Ok(())
}

async fn check_status(
    Path(id_str): Path<String>,
    State(state): State<AppState>,
) -> Response {
    let id = match Uuid::parse_str(&id_str) {
        Ok(u) => u,
        Err(_) => return (StatusCode::BAD_REQUEST, "Invalid UUID").into_response(),
    };

    let row = match sqlx::query("SELECT status, error_message, file_path FROM jobs WHERE id = $1")
        .bind(id)
        .fetch_optional(&state.pool)
        .await {
            Ok(Some(r)) => r,
            Ok(None) => return (StatusCode::NOT_FOUND, "Job not found").into_response(),
            Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
        };

    let status: String = row.get("status");

    match status.as_str() {
        "processing" => Json(JobStatusResponse::Processing).into_response(),
        "error" => {
            let msg: String = row.get("error_message");
            Json(JobStatusResponse::Error { message: msg }).into_response()
        },
        "completed" => {
            let path: String = row.get("file_path");
            
            // Check if file exists
            match tokio::fs::File::open(&path).await {
                Ok(file) => {
                    // Update last_accessed_at
                     let _ = sqlx::query("UPDATE jobs SET last_accessed_at = NOW() WHERE id = $1")
                        .bind(id)
                        .execute(&state.pool)
                        .await;

                    let stream = tokio_util::io::ReaderStream::new(file);
                    let body = Body::from_stream(stream);
                    
                    (
                        [
                            (header::CONTENT_TYPE, "audio/mpeg"),
                            (header::CONTENT_DISPOSITION, &format!("attachment; filename=\"{}.mp3\"", id)),
                        ],
                        body
                    ).into_response()
                }
                Err(_) => {
                    // Should theoretically not happen if storage is persistent and logic correct
                    (StatusCode::INTERNAL_SERVER_ERROR, "File missing from storage").into_response()
                }
            }
        },
        _ => (StatusCode::INTERNAL_SERVER_ERROR, "Unknown status").into_response(),
    }
}
