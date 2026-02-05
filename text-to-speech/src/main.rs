use axum::{
    extract::{Path, Multipart, State, Request},
    response::{IntoResponse, Response, Json},
    routing::{get, post},
    Router,
    http::{StatusCode, header},
    body::Body,
    middleware::{self, Next},
};
use serde::{Serialize, Deserialize};
use std::process::Command;
use std::sync::Arc;
use uuid::Uuid;
use tempfile::Builder;
use std::io::Write;
use sqlx::{postgres::PgPoolOptions, Pool, Postgres, Row};
use jsonwebtoken::{decode, decode_header, DecodingKey, Validation, Algorithm};
use tokio::sync::RwLock;
use std::collections::HashMap;

#[derive(Clone)]
struct AppState {
    pool: Pool<Postgres>,
    storage_path: String,
    jwks_cache: Arc<RwLock<JwksCache>>,
    keycloak_url: String,
    keycloak_realm: String,
}

#[derive(Default)]
struct JwksCache {
    keys: HashMap<String, DecodingKey>,
    last_fetched: Option<std::time::Instant>,
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct KeycloakClaims {
    exp: usize,
    iat: usize,
    sub: String,
    preferred_username: Option<String>,
}

#[derive(Debug, Deserialize)]
struct JwksResponse {
    keys: Vec<JwkKey>,
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct JwkKey {
    kid: String,
    kty: String,
    alg: Option<String>,
    n: String,
    e: String,
}

#[derive(Serialize)]
#[serde(tag = "status", rename_all = "lowercase")]
#[allow(dead_code)]
enum JobStatusResponse {
    Processing,
    Completed,
    Error { message: String },
}

async fn fetch_jwks(keycloak_url: &str, realm: &str) -> Result<HashMap<String, DecodingKey>, String> {
    let jwks_url = format!("{}/realms/{}/protocol/openid-connect/certs", keycloak_url, realm);

    let client = reqwest::Client::new();
    let response = client
        .get(&jwks_url)
        .send()
        .await
        .map_err(|e| format!("Failed to fetch JWKS: {}", e))?;

    let jwks: JwksResponse = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse JWKS: {}", e))?;

    let mut keys = HashMap::new();
    for key in jwks.keys {
        if key.kty == "RSA" {
            match DecodingKey::from_rsa_components(&key.n, &key.e) {
                Ok(decoding_key) => {
                    keys.insert(key.kid.clone(), decoding_key);
                }
                Err(e) => {
                    eprintln!("Failed to create decoding key for kid {}: {}", key.kid, e);
                }
            }
        }
    }

    Ok(keys)
}

async fn validate_token(state: &AppState, token: &str) -> Result<KeycloakClaims, String> {
    // Decode header to get kid
    let header = decode_header(token)
        .map_err(|e| format!("Invalid token header: {}", e))?;

    let kid = header.kid.ok_or("Token missing kid")?;

    // Check cache or fetch JWKS
    let decoding_key = {
        let cache = state.jwks_cache.read().await;
        if let Some(key) = cache.keys.get(&kid) {
            // Check if cache is still valid (less than 1 hour old)
            if let Some(last_fetched) = cache.last_fetched {
                if last_fetched.elapsed() < std::time::Duration::from_secs(3600) {
                    Some(key.clone())
                } else {
                    None
                }
            } else {
                None
            }
        } else {
            None
        }
    };

    let decoding_key = match decoding_key {
        Some(key) => key,
        None => {
            // Fetch new JWKS
            let new_keys = fetch_jwks(&state.keycloak_url, &state.keycloak_realm).await?;
            let key = new_keys.get(&kid).cloned()
                .ok_or_else(|| format!("Key with kid {} not found", kid))?;

            // Update cache
            let mut cache = state.jwks_cache.write().await;
            cache.keys = new_keys;
            cache.last_fetched = Some(std::time::Instant::now());

            key
        }
    };

    // Validate token
    let mut validation = Validation::new(Algorithm::RS256);
    validation.validate_exp = true;

    let token_data = decode::<KeycloakClaims>(token, &decoding_key, &validation)
        .map_err(|e| format!("Token validation failed: {}", e))?;

    Ok(token_data.claims)
}

async fn auth_middleware(
    State(state): State<AppState>,
    request: Request,
    next: Next,
) -> Result<Response, (StatusCode, String)> {
    // Skip auth in test mode
    if std::env::var("TTS_TEST_MODE").is_ok() {
        return Ok(next.run(request).await);
    }

    let auth_header = request
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|h| h.to_str().ok());

    let token = match auth_header {
        Some(h) if h.starts_with("Bearer ") => &h[7..],
        _ => return Err((StatusCode::UNAUTHORIZED, "Missing or invalid Authorization header".to_string())),
    };

    match validate_token(&state, token).await {
        Ok(claims) => {
            tracing::info!("Authenticated user: {:?}", claims.preferred_username);
            Ok(next.run(request).await)
        }
        Err(e) => {
            tracing::warn!("Authentication failed: {}", e);
            Err((StatusCode::UNAUTHORIZED, format!("Authentication failed: {}", e)))
        }
    }
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt::init();

    let database_url = std::env::var("DATABASE_URL").expect("DATABASE_URL must be set");
    let storage_path = std::env::var("STORAGE_PATH").unwrap_or_else(|_| "/app/storage".to_string());
    let keycloak_url = std::env::var("KEYCLOAK_URL").unwrap_or_else(|_| "http://keycloak.keycloak.svc.cluster.local".to_string());
    let keycloak_realm = std::env::var("KEYCLOAK_REALM").unwrap_or_else(|_| "homekube".to_string());

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
        jwks_cache: Arc::new(RwLock::new(JwksCache::default())),
        keycloak_url,
        keycloak_realm,
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
        .layer(middleware::from_fn_with_state(state.clone(), auth_middleware))
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
    // Flush to ensure all data is written to disk before external process reads it
    text_file.flush().map_err(|e| format!("Failed to flush text file: {}", e))?;
    let text_path = text_file.path().to_str().ok_or("Invalid path")?.to_string();

    let output_dir = std::path::Path::new(&storage_path);
    // wav intermediate in temp, mp3 result in persistent storage
    let wav_path = format!("/tmp/{}.wav", job_id); 
    let mp3_filename = format!("{}.mp3", job_id);
    let mp3_path = output_dir.join(&mp3_filename);

    // Check if we're in test mode (skip actual TTS, generate dummy audio)
    let test_mode = std::env::var("TTS_TEST_MODE").is_ok();

    if test_mode {
        // Generate a minimal valid WAV file for testing
        // WAV header (44 bytes) + 1 second of silence at 22050 Hz, 16-bit mono
        let sample_rate: u32 = 22050;
        let bits_per_sample: u16 = 16;
        let num_channels: u16 = 1;
        let duration_secs: u32 = 1;
        let data_size = sample_rate * duration_secs * (bits_per_sample as u32 / 8) * num_channels as u32;
        let file_size = 36 + data_size;

        let mut wav_data = Vec::with_capacity(44 + data_size as usize);
        // RIFF header
        wav_data.extend_from_slice(b"RIFF");
        wav_data.extend_from_slice(&file_size.to_le_bytes());
        wav_data.extend_from_slice(b"WAVE");
        // fmt subchunk
        wav_data.extend_from_slice(b"fmt ");
        wav_data.extend_from_slice(&16u32.to_le_bytes()); // subchunk size
        wav_data.extend_from_slice(&1u16.to_le_bytes());  // audio format (PCM)
        wav_data.extend_from_slice(&num_channels.to_le_bytes());
        wav_data.extend_from_slice(&sample_rate.to_le_bytes());
        wav_data.extend_from_slice(&(sample_rate * num_channels as u32 * bits_per_sample as u32 / 8).to_le_bytes()); // byte rate
        wav_data.extend_from_slice(&(num_channels * bits_per_sample / 8).to_le_bytes()); // block align
        wav_data.extend_from_slice(&bits_per_sample.to_le_bytes());
        // data subchunk
        wav_data.extend_from_slice(b"data");
        wav_data.extend_from_slice(&data_size.to_le_bytes());
        // Silent audio data (zeros)
        wav_data.extend(std::iter::repeat(0u8).take(data_size as usize));

        std::fs::write(&wav_path, wav_data)
            .map_err(|e| format!("Failed to write test WAV file: {}", e))?;

        println!("Test mode: Generated dummy WAV file at {}", wav_path);
    } else {
        // Production mode: run actual kokoro-tts
        let output = Command::new("kokoro-tts")
            .current_dir("/app")  // Model files are in /app
            .arg(&text_path)
            .arg(&wav_path)
            .arg("--voice")
            .arg(&voice)
            .arg("--speed")
            .arg(&speed)
            .output()
            .map_err(|e| format!("Failed to execute kokoro-tts: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            let stdout = String::from_utf8_lossy(&output.stdout);
            return Err(format!("kokoro-tts failed: stdout={}, stderr={}", stdout, stderr));
        }

        // Verify the WAV file was actually created
        if !std::path::Path::new(&wav_path).exists() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            return Err(format!("kokoro-tts did not produce output file. stdout: {}", stdout));
        }
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
