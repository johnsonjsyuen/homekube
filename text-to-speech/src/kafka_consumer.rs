use base64::Engine;
use base64::engine::general_purpose::STANDARD as BASE64;
use futures::StreamExt;
use rdkafka::ClientConfig;
use rdkafka::Message;
use rdkafka::consumer::{CommitMode, Consumer, StreamConsumer};
use rdkafka::message::BorrowedMessage;
use sqlx::{Pool, Postgres, Row};
use uuid::Uuid;

use crate::handlers::process_tts;
use crate::kafka_producer::TtsJobMessage;
use crate::metrics as metric_names;

const TOPIC: &str = "tts-jobs";
const GROUP_ID: &str = "tts-workers";

pub async fn run_consumer(
    brokers: String,
    pool: Pool<Postgres>,
    storage_path: String,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let consumer: StreamConsumer = ClientConfig::new()
        .set("bootstrap.servers", &brokers)
        .set("group.id", GROUP_ID)
        .set("auto.offset.reset", "earliest")
        .set("enable.auto.commit", "false")
        .set("session.timeout.ms", "30000")
        .set("max.poll.interval.ms", "600000")
        .create()?;

    consumer.subscribe(&[TOPIC])?;
    tracing::info!("TTS Kafka consumer connected (group: {})", GROUP_ID);

    let mut stream = consumer.stream();

    while let Some(result) = stream.next().await {
        let borrowed_msg = match result {
            Ok(m) => m,
            Err(e) => {
                tracing::error!(error = %e, "Kafka consumer error");
                continue;
            }
        };

        process_message(&borrowed_msg, &consumer, &pool, &storage_path).await;
    }

    Ok(())
}

async fn process_message(
    msg: &BorrowedMessage<'_>,
    consumer: &StreamConsumer,
    pool: &Pool<Postgres>,
    storage_path: &str,
) {
    let payload = match msg.payload() {
        Some(p) => p,
        None => {
            let _ = consumer.commit_message(msg, CommitMode::Sync);
            return;
        }
    };

    let job_msg: TtsJobMessage = match serde_json::from_slice(payload) {
        Ok(m) => m,
        Err(e) => {
            tracing::error!(error = %e, "Failed to deserialize TTS job message");
            let _ = consumer.commit_message(msg, CommitMode::Sync);
            return;
        }
    };

    let job_id = match Uuid::parse_str(&job_msg.job_id) {
        Ok(id) => id,
        Err(e) => {
            tracing::error!(error = %e, job_id = %job_msg.job_id, "Invalid job UUID");
            let _ = consumer.commit_message(msg, CommitMode::Sync);
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
                let _ = consumer.commit_message(msg, CommitMode::Sync);
                return;
            }
        }
        Ok(None) => {
            tracing::warn!(job_id = %job_id, "Job not found in DB, skipping");
            let _ = consumer.commit_message(msg, CommitMode::Sync);
            return;
        }
        Err(e) => {
            tracing::error!(job_id = %job_id, error = %e, "DB error checking job status, will retry");
            // Don't commit — transient DB error should trigger redelivery
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
            let _ = consumer.commit_message(msg, CommitMode::Sync);
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
            tracing::info!(job_id = %job_id, "TTS job completed via Kafka consumer");
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

    // Commit offset after processing (whether success or failure)
    if let Err(e) = consumer.commit_message(msg, CommitMode::Sync) {
        tracing::error!(job_id = %job_id, error = %e, "Failed to commit Kafka offset");
    }
}
