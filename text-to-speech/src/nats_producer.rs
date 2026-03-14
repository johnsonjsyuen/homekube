use async_nats::HeaderMap;
use async_nats::jetstream;
use serde::{Deserialize, Serialize};

const SUBJECT: &str = "tts.jobs";

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

pub struct NatsProducer {
    jetstream: jetstream::Context,
}

impl NatsProducer {
    pub async fn new(nats_url: &str) -> Result<Self, Box<dyn std::error::Error + Send + Sync>> {
        let client = async_nats::connect(nats_url).await?;
        let jetstream = jetstream::new(client);
        tracing::info!("NATS JetStream producer connected to {}", nats_url);
        Ok(Self { jetstream })
    }

    pub async fn produce_tts_job(
        &self,
        msg: &TtsJobMessage,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let payload = serde_json::to_string(msg)?;
        let mut headers = HeaderMap::new();
        headers.insert("Nats-Msg-Id", msg.job_id.as_str());
        self.jetstream
            .publish_with_headers(SUBJECT, headers, payload.into())
            .await?
            .await?;
        tracing::info!(job_id = %msg.job_id, "Produced TTS job to NATS JetStream");
        Ok(())
    }
}
