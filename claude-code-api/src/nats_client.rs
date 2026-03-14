use async_nats::jetstream;
use serde::Serialize;

// ---------------------------------------------------------------------------
// NATS JetStream client wrapper
// ---------------------------------------------------------------------------

#[derive(Clone)]
pub struct NatsClient {
    jetstream: jetstream::Context,
}

#[derive(Serialize)]
struct ChatEvent<'a> {
    user_id: &'a str,
    conversation_id: &'a str,
    role: &'a str,
    content: &'a str,
}

impl NatsClient {
    /// Connect to NATS and obtain a JetStream context.
    pub async fn connect(nats_url: &str) -> Result<Self, async_nats::ConnectError> {
        let client = async_nats::connect(nats_url).await?;
        let jetstream = jetstream::new(client);
        Ok(Self { jetstream })
    }

    /// Publish a chat message event to `chat.{user_id}.{conversation_id}`.
    pub async fn publish_chat_message(
        &self,
        user_id: &str,
        conversation_id: &str,
        role: &str,
        content: &str,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let subject = format!("chat.{user_id}.{conversation_id}");
        let payload = serde_json::to_vec(&ChatEvent {
            user_id,
            conversation_id,
            role,
            content,
        })?;
        self.jetstream
            .publish(subject, payload.into())
            .await?
            .await?;
        Ok(())
    }
}
