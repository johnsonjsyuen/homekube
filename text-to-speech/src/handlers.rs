use crate::state::AppState;
use axum::{
    body::Body,
    extract::{Multipart, Path, State},
    http::{header, StatusCode},
    response::{IntoResponse, Json, Response},
};
use serde::Serialize;
use sqlx::{Pool, Postgres, Row};
use std::io::Write;
use std::process::{Command, Stdio};
use tempfile::Builder;
use uuid::Uuid;

#[derive(Serialize)]
#[serde(tag = "status", rename_all = "lowercase")]
#[allow(dead_code)]
enum JobStatusResponse {
    Processing,
    Completed,
    Error { message: String },
}

pub async fn generate_speech(
    State(state): State<AppState>,
    mut multipart: Multipart,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    tracing::info!("Received generate_speech request");

    let mut text_content = None;
    let mut speed = "1.0".to_string();
    let mut voice = "af_heart".to_string();

    while let Some(field) = multipart.next_field().await.map_err(|e| {
        tracing::error!(error = %e, "Failed to parse multipart field");
        (StatusCode::BAD_REQUEST, e.to_string())
    })? {
        let name = field.name().unwrap_or("").to_string();
        tracing::debug!(field_name = %name, "Processing multipart field");

        if name == "text_file" {
            let data = field.bytes().await.map_err(|e| {
                tracing::error!(error = %e, "Failed to read text_file bytes");
                (StatusCode::INTERNAL_SERVER_ERROR, e.to_string())
            })?;
            tracing::info!(size_bytes = data.len(), "Received text_file");
            text_content = Some(data);
        } else if name == "speed" {
            let txt = field.text().await.map_err(|e| {
                tracing::error!(error = %e, "Failed to read speed field");
                (StatusCode::BAD_REQUEST, e.to_string())
            })?;
            speed = txt;
        } else if name == "voice" {
            let txt = field.text().await.map_err(|e| {
                tracing::error!(error = %e, "Failed to read voice field");
                (StatusCode::BAD_REQUEST, e.to_string())
            })?;
            voice = txt;
        }
    }

    let text_bytes = text_content.ok_or_else(|| {
        tracing::error!("Missing text_file field in request");
        (
            StatusCode::BAD_REQUEST,
            "Missing text_file field".to_string(),
        )
    })?;

    if speed.parse::<f32>().is_err() {
        tracing::error!(speed = %speed, "Invalid speed parameter");
        return Err((
            StatusCode::BAD_REQUEST,
            "Invalid speed parameter".to_string(),
        ));
    }

    tracing::info!(speed = %speed, voice = %voice, text_size_bytes = text_bytes.len(), "Processing TTS request");

    let job_id = Uuid::new_v4();

    // Insert into DB
    tracing::info!(job_id = %job_id, "Creating job in database");
    sqlx::query("INSERT INTO jobs (id, status) VALUES ($1, 'processing')")
        .bind(job_id)
        .execute(&state.pool)
        .await
        .map_err(|e| {
            tracing::error!(job_id = %job_id, error = %e, "Failed to insert job into database");
            (StatusCode::INTERNAL_SERVER_ERROR, e.to_string())
        })?;

    let pool = state.pool.clone();
    let storage_path = state.storage_path.clone();

    tokio::task::spawn_blocking(move || {
        let rt = tokio::runtime::Handle::current();
        tracing::info!(job_id = %job_id, "Starting TTS processing in background");
        if let Err(e) = process_tts(
            pool.clone(),
            job_id,
            text_bytes,
            speed,
            voice,
            storage_path,
            &rt,
        ) {
            tracing::error!(job_id = %job_id, error = %e, "TTS processing failed");
            rt.block_on(async {
                let _ = sqlx::query(
                    "UPDATE jobs SET status = 'error', error_message = $1 WHERE id = $2",
                )
                .bind(&e)
                .bind(job_id)
                .execute(&pool)
                .await;
            });
        } else {
            tracing::info!(job_id = %job_id, "TTS processing completed successfully");
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
    tracing::info!(job_id = %job_id, "Starting TTS processing");

    // 1. Write text content to a temp file
    tracing::debug!(job_id = %job_id, "Creating temporary text file");
    let mut text_file = Builder::new()
        .suffix(".txt")
        .tempfile()
        .map_err(|e| format!("Failed to create temp text file: {}", e))?;
    text_file
        .write_all(&text_bytes)
        .map_err(|e| format!("Failed to write text file: {}", e))?;
    // Flush to ensure all data is written to disk before external process reads it
    text_file
        .flush()
        .map_err(|e| format!("Failed to flush text file: {}", e))?;
    let text_path = text_file.path().to_str().ok_or("Invalid path")?.to_string();
    tracing::debug!(job_id = %job_id, text_path = %text_path, "Text file created");

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
        let data_size =
            sample_rate * duration_secs * (bits_per_sample as u32 / 8) * num_channels as u32;
        let file_size = 36 + data_size;

        let mut wav_data = Vec::with_capacity(44 + data_size as usize);
        // RIFF header
        wav_data.extend_from_slice(b"RIFF");
        wav_data.extend_from_slice(&file_size.to_le_bytes());
        wav_data.extend_from_slice(b"WAVE");
        // fmt subchunk
        wav_data.extend_from_slice(b"fmt ");
        wav_data.extend_from_slice(&16u32.to_le_bytes()); // subchunk size
        wav_data.extend_from_slice(&1u16.to_le_bytes()); // audio format (PCM)
        wav_data.extend_from_slice(&num_channels.to_le_bytes());
        wav_data.extend_from_slice(&sample_rate.to_le_bytes());
        wav_data.extend_from_slice(
            &(sample_rate * num_channels as u32 * bits_per_sample as u32 / 8).to_le_bytes(),
        ); // byte rate
        wav_data.extend_from_slice(&(num_channels * bits_per_sample / 8).to_le_bytes()); // block align
        wav_data.extend_from_slice(&bits_per_sample.to_le_bytes());
        // data subchunk
        wav_data.extend_from_slice(b"data");
        wav_data.extend_from_slice(&data_size.to_le_bytes());
        // Silent audio data (zeros)
        wav_data.extend(std::iter::repeat(0u8).take(data_size as usize));

        std::fs::write(&wav_path, wav_data)
            .map_err(|e| format!("Failed to write test WAV file: {}", e))?;

        tracing::info!(job_id = %job_id, wav_path = %wav_path, "Test mode: Generated dummy WAV file");
    } else {
        // Production mode: run actual kokoro-tts
        tracing::info!(
            job_id = %job_id,
            text_path = %text_path,
            wav_path = %wav_path,
            voice = %voice,
            speed = %speed,
            "Executing kokoro-tts"
        );
        let mut child = Command::new("kokoro-tts")
            .current_dir("/app") // Model files are in /app
            .arg(&text_path)
            .arg(&wav_path)
            .arg("--voice")
            .arg(&voice)
            .arg("--speed")
            .arg(&speed)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Failed to spawn kokoro-tts: {}", e))?;

        // Stream stdout and stderr in separate threads so we get real-time logs
        // even if the process is OOM-killed
        let stdout = child.stdout.take();
        let stderr = child.stderr.take();
        let job_id_str = job_id.to_string();

        let stdout_job_id = job_id_str.clone();
        let stdout_handle = std::thread::spawn(move || {
            use std::io::BufRead;
            let mut collected = String::new();
            if let Some(out) = stdout {
                for line in std::io::BufReader::new(out).lines() {
                    match line {
                        Ok(l) => {
                            tracing::info!(job_id = %stdout_job_id, line = %l, "kokoro-tts stdout");
                            collected.push_str(&l);
                            collected.push('\n');
                        }
                        Err(e) => {
                            tracing::warn!(job_id = %stdout_job_id, error = %e, "Error reading kokoro-tts stdout");
                            break;
                        }
                    }
                }
            }
            collected
        });

        let stderr_job_id = job_id_str.clone();
        let stderr_handle = std::thread::spawn(move || {
            use std::io::BufRead;
            let mut collected = String::new();
            if let Some(err) = stderr {
                for line in std::io::BufReader::new(err).lines() {
                    match line {
                        Ok(l) => {
                            tracing::warn!(job_id = %stderr_job_id, line = %l, "kokoro-tts stderr");
                            collected.push_str(&l);
                            collected.push('\n');
                        }
                        Err(e) => {
                            tracing::warn!(job_id = %stderr_job_id, error = %e, "Error reading kokoro-tts stderr");
                            break;
                        }
                    }
                }
            }
            collected
        });

        let status = child.wait().map_err(|e| format!("Failed to wait on kokoro-tts: {}", e))?;
        let stdout_output = stdout_handle.join().unwrap_or_default();
        let stderr_output = stderr_handle.join().unwrap_or_default();

        let exit_code = status.code();
        tracing::info!(job_id = %job_id, exit_code = ?exit_code, "kokoro-tts process exited");

        if !status.success() {
            tracing::error!(
                job_id = %job_id,
                exit_code = ?exit_code,
                "kokoro-tts failed"
            );
            return Err(format!(
                "kokoro-tts failed (exit code {:?}): stdout={}, stderr={}",
                exit_code, stdout_output, stderr_output
            ));
        }
        tracing::info!(job_id = %job_id, "kokoro-tts completed successfully");

        // Verify the WAV file was actually created
        if !std::path::Path::new(&wav_path).exists() {
            tracing::error!(job_id = %job_id, wav_path = %wav_path, "kokoro-tts did not produce output file");
            return Err(format!(
                "kokoro-tts did not produce output file. stdout: {}",
                stdout_output
            ));
        }
    }

    let mp3_path_str = mp3_path.to_str().ok_or("Invalid MP3 path")?;
    tracing::info!(job_id = %job_id, wav_path = %wav_path, mp3_path = %mp3_path_str, "Executing ffmpeg to convert WAV to MP3");
    let ffmpeg_output = Command::new("ffmpeg")
        .arg("-i")
        .arg(&wav_path)
        .arg("-b:a")
        .arg("192k")
        .arg("-y")
        .arg(mp3_path_str)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .map_err(|e| format!("Failed to execute ffmpeg: {}", e))?;

    if !ffmpeg_output.status.success() {
        let stderr = String::from_utf8_lossy(&ffmpeg_output.stderr);
        let stdout = String::from_utf8_lossy(&ffmpeg_output.stdout);
        let exit_code = ffmpeg_output.status.code();
        tracing::error!(
            job_id = %job_id,
            exit_code = ?exit_code,
            stdout = %stdout,
            stderr = %stderr,
            "ffmpeg failed"
        );
        return Err(format!(
            "ffmpeg failed (exit code {:?}): {}",
            exit_code, stderr
        ));
    }
    tracing::info!(
        job_id = %job_id,
        stderr = %String::from_utf8_lossy(&ffmpeg_output.stderr),
        "ffmpeg conversion completed successfully"
    );

    // Cleanup wav file
    let _ = std::fs::remove_file(wav_path);

    // Update DB
    rt.block_on(async {
        let _ = sqlx::query("UPDATE jobs SET status = 'completed', file_path = $1 WHERE id = $2")
            .bind(mp3_path_str)
            .bind(job_id)
            .execute(&pool)
            .await;
    });

    Ok(())
}

pub async fn check_status(Path(id_str): Path<String>, State(state): State<AppState>) -> Response {
    tracing::debug!(job_id = %id_str, "Checking job status");
    let id = match Uuid::parse_str(&id_str) {
        Ok(u) => u,
        Err(_) => {
            tracing::warn!(job_id = %id_str, "Invalid UUID in status check");
            return (StatusCode::BAD_REQUEST, "Invalid UUID").into_response();
        }
    };

    let row = match sqlx::query("SELECT status, error_message, file_path FROM jobs WHERE id = $1")
        .bind(id)
        .fetch_optional(&state.pool)
        .await
    {
        Ok(Some(r)) => r,
        Ok(None) => {
            tracing::debug!(job_id = %id, "Job not found");
            return (StatusCode::NOT_FOUND, "Job not found").into_response();
        }
        Err(e) => {
            tracing::error!(job_id = %id, error = %e, "Database error while fetching job");
            return (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response();
        }
    };

    let status: String = row.get("status");
    tracing::debug!(job_id = %id, status = %status, "Job status retrieved");

    match status.as_str() {
        "processing" => Json(JobStatusResponse::Processing).into_response(),
        "error" => {
            let msg: String = row.get("error_message");
            Json(JobStatusResponse::Error { message: msg }).into_response()
        }
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
                            (
                                header::CONTENT_DISPOSITION,
                                &format!("attachment; filename=\"{}.mp3\"", id),
                            ),
                        ],
                        body,
                    )
                        .into_response()
                }
                Err(e) => {
                    // Should theoretically not happen if storage is persistent and logic correct
                    tracing::error!(job_id = %id, path = %path, error = %e, "File missing from storage");
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        "File missing from storage",
                    )
                        .into_response()
                }
            }
        }
        _ => {
            tracing::error!(job_id = %id, status = %status, "Unknown job status in database");
            (StatusCode::INTERNAL_SERVER_ERROR, "Unknown status").into_response()
        }
    }
}
