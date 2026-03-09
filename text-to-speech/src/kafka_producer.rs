use rdkafka::ClientConfig;
use rdkafka::producer::{FutureProducer, FutureRecord};
use serde::{Deserialize, Serialize};
use std::time::Duration;

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
    producer: FutureProducer,
}

impl KafkaProducer {
    pub fn new(brokers: &str) -> Result<Self, Box<dyn std::error::Error + Send + Sync>> {
        let producer: FutureProducer = ClientConfig::new()
            .set("bootstrap.servers", brokers)
            .set("message.timeout.ms", "5000")
            .set("acks", "all")
            .create()?;
        tracing::info!("Kafka producer connected to {}", brokers);
        Ok(Self { producer })
    }

    pub async fn produce_tts_job(
        &self,
        msg: &TtsJobMessage,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let payload = serde_json::to_string(msg)?;
        self.producer
            .send(
                FutureRecord::to(TOPIC).key(&msg.job_id).payload(&payload),
                Duration::from_secs(5),
            )
            .await
            .map_err(|(e, _)| Box::new(e) as Box<dyn std::error::Error + Send + Sync>)?;
        tracing::info!(job_id = %msg.job_id, "Produced TTS job to Kafka");
        Ok(())
    }
}
