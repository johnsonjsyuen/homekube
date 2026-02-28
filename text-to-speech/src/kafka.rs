use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use chrono::Utc;
use rskafka::client::partition::{Compression, OffsetAt, UnknownTopicHandling};
use rskafka::client::ClientBuilder;
use rskafka::record::Record;
use serde::{Deserialize, Serialize};
use sqlx::{Pool, Postgres, Row};
use std::collections::BTreeMap;
use std::sync::Arc;
use uuid::Uuid;

use crate::handlers::process_tts;
use crate::metrics as metric_names;

const TOPIC: &str = "tts-jobs";

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TtsJobMessage {
    pub job_id: String,
    pub username: String,
    pub text_base64: String,
    pub voice: String,
    pub speed: String,
    pub input_filename: Option<String>,
    pub timestamp: String,
}

pub struct KafkaProducer {
    partition_client: Arc<rskafka::client::partition::PartitionClient>,
}

impl KafkaProducer {
    pub async fn new(broker: &str) -> Result<Self, Box<dyn std::error::Error + Send + Sync>> {
        let client = ClientBuilder::new(vec![broker.to_string()]).build().await?;

        // Try to create topic (ignore error if it already exists)
        let controller = client.controller_client().await?;
        match controller.create_topic(TOPIC, 1, 1, 5_000).await {
            Ok(()) => tracing::info!("Created Kafka topic '{}'", TOPIC),
            Err(e) => tracing::debug!(error = %e, "Topic '{}' creation skipped (may already exist)", TOPIC),
        }

        let partition_client = client
            .partition_client(TOPIC, 0, UnknownTopicHandling::Retry)
            .await?;
        tracing::info!("Kafka producer connected to {}", broker);
        Ok(Self {
            partition_client: Arc::new(partition_client),
        })
    }

    pub async fn produce_tts_job(
        &self,
        msg: &TtsJobMessage,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let value = serde_json::to_vec(msg)?;
        let record = Record {
            key: Some(msg.job_id.as_bytes().to_vec()),
            value: Some(value),
            headers: BTreeMap::new(),
            timestamp: Utc::now(),
        };
        self.partition_client
            .produce(vec![record], Compression::NoCompression)
            .await?;
        tracing::info!(job_id = %msg.job_id, "Produced TTS job to Kafka");
        Ok(())
    }
}

pub async fn start_tts_consumer(broker: String, pool: Pool<Postgres>, storage_path: String) {
    loop {
        if let Err(e) = run_consumer_loop(&broker, &pool, &storage_path).await {
            tracing::error!(error = %e, "TTS Kafka consumer error, restarting in 5s");
            tokio::time::sleep(tokio::time::Duration::from_secs(5)).await;
        }
    }
}

async fn run_consumer_loop(
    broker: &str,
    pool: &Pool<Postgres>,
    storage_path: &str,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let client = ClientBuilder::new(vec![broker.to_string()]).build().await?;
    let partition_client = client
        .partition_client(TOPIC, 0, UnknownTopicHandling::Retry)
        .await?;
    tracing::info!("TTS Kafka consumer connected");

    // Start from the latest offset (only process new messages)
    let watermark = partition_client.get_offset(OffsetAt::Latest).await?;
    let mut offset = watermark;
    tracing::info!(offset = offset, "TTS consumer starting from offset");

    loop {
        let (records, _high_watermark) = partition_client
            .fetch_records(offset, 1..1_048_576, 5_000)
            .await?;

        if records.is_empty() {
            tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;
            continue;
        }

        for record_and_offset in &records {
            offset = record_and_offset.offset + 1;

            let value = match &record_and_offset.record.value {
                Some(v) => v,
                None => continue,
            };

            let msg: TtsJobMessage = match serde_json::from_slice(value) {
                Ok(m) => m,
                Err(e) => {
                    tracing::error!(error = %e, "Failed to deserialize TTS job message");
                    continue;
                }
            };

            let job_id = match Uuid::parse_str(&msg.job_id) {
                Ok(id) => id,
                Err(e) => {
                    tracing::error!(error = %e, job_id = %msg.job_id, "Invalid job UUID");
                    continue;
                }
            };

            // Idempotency: check DB status — skip if not pending
            match sqlx::query("SELECT status FROM jobs WHERE id = $1")
                .bind(job_id)
                .fetch_optional(pool)
                .await
            {
                Ok(Some(r)) => {
                    let status: String = r.get("status");
                    if status != "pending" {
                        tracing::debug!(job_id = %job_id, status = %status, "Skipping non-pending job");
                        continue;
                    }
                }
                Ok(None) => {
                    tracing::warn!(job_id = %job_id, "Job not found in DB, skipping");
                    continue;
                }
                Err(e) => {
                    tracing::error!(job_id = %job_id, error = %e, "DB error checking job status");
                    continue;
                }
            }

            // Update status to processing
            let _ = sqlx::query("UPDATE jobs SET status = 'processing' WHERE id = $1")
                .bind(job_id)
                .execute(pool)
                .await;

            metrics::gauge!(metric_names::TTS_ACTIVE_JOBS).increment(1);

            // Decode base64 text
            let text_bytes = match BASE64.decode(&msg.text_base64) {
                Ok(b) => b,
                Err(e) => {
                    tracing::error!(job_id = %job_id, error = %e, "Failed to decode base64 text");
                    let _ = sqlx::query(
                        "UPDATE jobs SET status = 'error', error_message = $1 WHERE id = $2",
                    )
                    .bind(format!("Base64 decode error: {}", e))
                    .bind(job_id)
                    .execute(pool)
                    .await;
                    metrics::counter!(metric_names::TTS_JOBS_TOTAL, "status" => "failed")
                        .increment(1);
                    metrics::gauge!(metric_names::TTS_ACTIVE_JOBS).decrement(1);
                    continue;
                }
            };

            // Process TTS in blocking thread
            let pool_clone = pool.clone();
            let storage = storage_path.to_string();
            let speed = msg.speed.clone();
            let voice = msg.voice.clone();

            let result = tokio::task::spawn_blocking(move || {
                let rt = tokio::runtime::Handle::current();
                process_tts(pool_clone.clone(), job_id, text_bytes, speed, voice, storage, &rt)
            })
            .await;

            match result {
                Ok(Ok(())) => {
                    tracing::info!(job_id = %job_id, "TTS job completed via Kafka consumer");
                    metrics::counter!(metric_names::TTS_JOBS_TOTAL, "status" => "completed")
                        .increment(1);
                    metrics::gauge!(metric_names::TTS_ACTIVE_JOBS).decrement(1);
                }
                Ok(Err(e)) => {
                    tracing::error!(job_id = %job_id, error = %e, "TTS processing failed");
                    let _ = sqlx::query(
                        "UPDATE jobs SET status = 'error', error_message = $1 WHERE id = $2",
                    )
                    .bind(&e)
                    .bind(job_id)
                    .execute(pool)
                    .await;
                    metrics::counter!(metric_names::TTS_JOBS_TOTAL, "status" => "failed")
                        .increment(1);
                    metrics::gauge!(metric_names::TTS_ACTIVE_JOBS).decrement(1);
                }
                Err(e) => {
                    tracing::error!(job_id = %job_id, error = %e, "TTS spawn_blocking panicked");
                    let _ = sqlx::query(
                        "UPDATE jobs SET status = 'error', error_message = $1 WHERE id = $2",
                    )
                    .bind(format!("Task panicked: {}", e))
                    .bind(job_id)
                    .execute(pool)
                    .await;
                    metrics::counter!(metric_names::TTS_JOBS_TOTAL, "status" => "failed")
                        .increment(1);
                    metrics::gauge!(metric_names::TTS_ACTIVE_JOBS).decrement(1);
                }
            }
        }
    }
}
