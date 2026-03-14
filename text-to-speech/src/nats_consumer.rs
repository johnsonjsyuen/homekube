use async_nats::jetstream;
use async_nats::jetstream::consumer::PullConsumer;
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use futures::StreamExt;
use sqlx::{Pool, Postgres, Row};
use uuid::Uuid;

use crate::handlers::process_tts;
use crate::metrics as metric_names;
use crate::nats_producer::TtsJobMessage;

const STREAM: &str = "TTS_JOBS";
const CONSUMER: &str = "tts-workers";

pub async fn run_consumer(
    nats_url: String,
    pool: Pool<Postgres>,
    storage_path: String,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let client = async_nats::connect(&nats_url).await?;
    let jetstream = jetstream::new(client);

    let stream = jetstream.get_stream(STREAM).await?;
    let consumer: PullConsumer = stream.get_consumer(CONSUMER).await?;

    tracing::info!("NATS JetStream consumer connected (consumer: {})", CONSUMER);

    let mut messages = consumer.messages().await?;

    while let Some(result) = messages.next().await {
        let msg = match result {
            Ok(m) => m,
            Err(e) => {
                tracing::error!(error = %e, "NATS consumer error");
                continue;
            }
        };

        process_message(&msg, &pool, &storage_path).await;
    }

    Ok(())
}

async fn process_message(
    msg: &jetstream::Message,
    pool: &Pool<Postgres>,
    storage_path: &str,
) {
    let payload = msg.payload.as_ref();
    if payload.is_empty() {
        let _ = msg.ack().await;
        return;
    }

    let job_msg: TtsJobMessage = match serde_json::from_slice(payload) {
        Ok(m) => m,
        Err(e) => {
            tracing::error!(error = %e, "Failed to deserialize TTS job message");
            let _ = msg.ack().await;
            return;
        }
    };

    let job_id = match Uuid::parse_str(&job_msg.job_id) {
        Ok(id) => id,
        Err(e) => {
            tracing::error!(error = %e, job_id = %job_msg.job_id, "Invalid job UUID");
            let _ = msg.ack().await;
            return;
        }
    };

    // Idempotency: check DB status -- skip if not pending
    match sqlx::query("SELECT status FROM jobs WHERE id = $1")
        .bind(job_id)
        .fetch_optional(pool)
        .await
    {
        Ok(Some(r)) => {
            let status: String = r.get("status");
            if status != "pending" {
                tracing::debug!(job_id = %job_id, status = %status, "Skipping non-pending job");
                let _ = msg.ack().await;
                return;
            }
        }
        Ok(None) => {
            tracing::warn!(job_id = %job_id, "Job not found in DB, skipping");
            let _ = msg.ack().await;
            return;
        }
        Err(e) => {
            tracing::error!(job_id = %job_id, error = %e, "DB error checking job status, will retry");
            // Don't ack — NATS will redeliver after ack_wait
            return;
        }
    }

    // Update status to processing
    let _ = sqlx::query("UPDATE jobs SET status = 'processing' WHERE id = $1")
        .bind(job_id)
        .execute(pool)
        .await;

    metrics::gauge!(metric_names::TTS_ACTIVE_JOBS).increment(1);

    // Decode base64 text
    let text_bytes = match BASE64.decode(&job_msg.text_base64) {
        Ok(b) => b,
        Err(e) => {
            tracing::error!(job_id = %job_id, error = %e, "Failed to decode base64 text");
            let _ =
                sqlx::query("UPDATE jobs SET status = 'error', error_message = $1 WHERE id = $2")
                    .bind(format!("Base64 decode error: {}", e))
                    .bind(job_id)
                    .execute(pool)
                    .await;
            metrics::counter!(metric_names::TTS_JOBS_TOTAL, "status" => "failed").increment(1);
            metrics::gauge!(metric_names::TTS_ACTIVE_JOBS).decrement(1);
            let _ = msg.ack().await;
            return;
        }
    };

    // Process TTS in blocking thread
    let pool_clone = pool.clone();
    let storage = storage_path.to_string();
    let speed = job_msg.speed.clone();
    let voice = job_msg.voice.clone();

    let result = tokio::task::spawn_blocking(move || {
        let rt = tokio::runtime::Handle::current();
        process_tts(
            pool_clone.clone(),
            job_id,
            text_bytes,
            speed,
            voice,
            storage,
            &rt,
        )
    })
    .await;

    match result {
        Ok(Ok(())) => {
            tracing::info!(job_id = %job_id, "TTS job completed via NATS consumer");
            metrics::counter!(metric_names::TTS_JOBS_TOTAL, "status" => "completed").increment(1);
            metrics::gauge!(metric_names::TTS_ACTIVE_JOBS).decrement(1);
        }
        Ok(Err(e)) => {
            tracing::error!(job_id = %job_id, error = %e, "TTS processing failed");
            let _ =
                sqlx::query("UPDATE jobs SET status = 'error', error_message = $1 WHERE id = $2")
                    .bind(&e)
                    .bind(job_id)
                    .execute(pool)
                    .await;
            metrics::counter!(metric_names::TTS_JOBS_TOTAL, "status" => "failed").increment(1);
            metrics::gauge!(metric_names::TTS_ACTIVE_JOBS).decrement(1);
        }
        Err(e) => {
            tracing::error!(job_id = %job_id, error = %e, "TTS spawn_blocking panicked");
            let _ =
                sqlx::query("UPDATE jobs SET status = 'error', error_message = $1 WHERE id = $2")
                    .bind(format!("Task panicked: {}", e))
                    .bind(job_id)
                    .execute(pool)
                    .await;
            metrics::counter!(metric_names::TTS_JOBS_TOTAL, "status" => "failed").increment(1);
            metrics::gauge!(metric_names::TTS_ACTIVE_JOBS).decrement(1);
        }
    }

    // Ack after processing (whether success or failure)
    if let Err(e) = msg.ack().await {
        tracing::error!(job_id = %job_id, error = %e, "Failed to ack NATS message");
    }
}
