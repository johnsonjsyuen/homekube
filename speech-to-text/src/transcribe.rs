//! WebSocket handler for real-time speech-to-text transcription.
//! 
//! This module handles bidirectional WebSocket communication between the browser
//! and vLLM's realtime API for Voxtral model transcription.

use crate::auth::{extract_token_from_query, validate_ws_token};
use crate::state::AppState;
use axum::{
    extract::{
        State, WebSocketUpgrade,
        ws::{Message, WebSocket},
    },
    http::Uri,
    response::Response,
};
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use tokio_tungstenite::{connect_async, tungstenite::Message as TungMessage};

/// Request to start a transcription session
#[derive(Debug, Serialize)]
struct SessionConfig {
    #[serde(rename = "type")]
    msg_type: String,
    session: SessionParams,
}

#[derive(Debug, Serialize)]
struct SessionParams {
    modalities: Vec<String>,
    input_audio_format: String,
    input_audio_transcription: TranscriptionConfig,
    temperature: f32,
}

#[derive(Debug, Serialize)]
struct TranscriptionConfig {
    model: String,
}

/// Audio input message to vLLM
#[derive(Debug, Serialize)]
struct AudioInput {
    #[serde(rename = "type")]
    msg_type: String,
    audio: String, // base64 encoded audio
}

/// End of audio stream message
#[derive(Debug, Serialize)]
struct AudioCommit {
    #[serde(rename = "type")]
    msg_type: String,
}

/// Response from vLLM containing transcription
#[derive(Debug, Deserialize)]
struct VllmResponse {
    #[serde(rename = "type")]
    msg_type: String,
    #[serde(default)]
    transcript: Option<String>,
    #[serde(default)]
    delta: Option<TranscriptDelta>,
    #[serde(default)]
    error: Option<VllmError>,
}

#[derive(Debug, Deserialize)]
struct TranscriptDelta {
    #[serde(default)]
    transcript: Option<String>,
}

#[derive(Debug, Deserialize)]
struct VllmError {
    message: String,
}

/// Message sent to browser client
#[derive(Debug, Serialize)]
struct ClientMessage {
    #[serde(rename = "type")]
    msg_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

impl ClientMessage {
    fn transcript(text: String) -> Self {
        Self {
            msg_type: "transcript".to_string(),
            text: Some(text),
            error: None,
        }
    }

    fn error(msg: String) -> Self {
        Self {
            msg_type: "error".to_string(),
            text: None,
            error: Some(msg),
        }
    }

    fn connected() -> Self {
        Self {
            msg_type: "connected".to_string(),
            text: None,
            error: None,
        }
    }
}

/// WebSocket upgrade handler
pub async fn ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
    uri: Uri,
) -> Response {
    // Extract token from query string
    let token = extract_token_from_query(uri.query());

    ws.on_upgrade(move |socket| handle_socket(socket, state, token))
}

/// Handle the WebSocket connection
async fn handle_socket(socket: WebSocket, state: AppState, token: Option<String>) {
    // Validate authentication
    let token = match token {
        Some(t) => t,
        None => {
            let (mut sender, _) = socket.split();
            let msg = ClientMessage::error("Missing authentication token".to_string());
            let _ = sender
                .send(Message::Text(serde_json::to_string(&msg).unwrap().into()))
                .await;
            return;
        }
    };

    let user = match validate_ws_token(&state, &token).await {
        Ok(u) => u,
        Err(e) => {
            let (mut sender, _) = socket.split();
            let msg = ClientMessage::error(format!("Authentication failed: {}", e));
            let _ = sender
                .send(Message::Text(serde_json::to_string(&msg).unwrap().into()))
                .await;
            return;
        }
    };

    tracing::info!(user = %user.username, "WebSocket connection authenticated");

    // Connect to vLLM realtime API
    let vllm_ws_url = format!("{}/v1/realtime", state.vllm_url.replace("http", "ws"));
    
    let vllm_conn = match connect_async(&vllm_ws_url).await {
        Ok((ws, _)) => ws,
        Err(e) => {
            let (mut sender, _) = socket.split();
            let msg = ClientMessage::error(format!("Failed to connect to transcription service: {}", e));
            let _ = sender
                .send(Message::Text(serde_json::to_string(&msg).unwrap().into()))
                .await;
            tracing::error!(error = %e, "Failed to connect to vLLM");
            return;
        }
    };

    let (mut vllm_sink, mut vllm_stream) = vllm_conn.split();
    let (mut client_sink, mut client_stream) = socket.split();

    // Send session configuration to vLLM
    let session_config = SessionConfig {
        msg_type: "session.update".to_string(),
        session: SessionParams {
            modalities: vec!["text".to_string()],
            input_audio_format: "pcm16".to_string(),
            input_audio_transcription: TranscriptionConfig {
                model: "Voxtral-Mini-4B-Realtime-2602".to_string(),
            },
            temperature: 0.0,
        },
    };

    if let Err(e) = vllm_sink
        .send(TungMessage::Text(serde_json::to_string(&session_config).unwrap().into()))
        .await
    {
        tracing::error!(error = %e, "Failed to send session config to vLLM");
        return;
    }

    // Notify client that connection is ready
    let connected_msg = ClientMessage::connected();
    if let Err(e) = client_sink
        .send(Message::Text(serde_json::to_string(&connected_msg).unwrap().into()))
        .await
    {
        tracing::error!(error = %e, "Failed to send connected message to client");
        return;
    }

    // Spawn task to forward client audio to vLLM
    let client_to_vllm = async move {
        while let Some(msg) = client_stream.next().await {
            match msg {
                Ok(Message::Text(text)) => {
                    // Client sends JSON with audio data
                    if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&text) {
                        if let Some(audio_data) = parsed.get("audio").and_then(|v| v.as_str()) {
                            let audio_msg = AudioInput {
                                msg_type: "input_audio_buffer.append".to_string(),
                                audio: audio_data.to_string(),
                            };
                            if let Err(e) = vllm_sink
                                .send(TungMessage::Text(serde_json::to_string(&audio_msg).unwrap().into()))
                                .await
                            {
                                tracing::error!(error = %e, "Failed to forward audio to vLLM");
                                break;
                            }
                        } else if parsed.get("type").and_then(|v| v.as_str()) == Some("commit") {
                            // Client signals end of audio chunk
                            let commit_msg = AudioCommit {
                                msg_type: "input_audio_buffer.commit".to_string(),
                            };
                            if let Err(e) = vllm_sink
                                .send(TungMessage::Text(serde_json::to_string(&commit_msg).unwrap().into()))
                                .await
                            {
                                tracing::error!(error = %e, "Failed to send commit to vLLM");
                                break;
                            }
                        }
                    }
                }
                Ok(Message::Binary(data)) => {
                    // Direct binary audio data - encode as base64 and forward
                    let audio_b64 = base64::Engine::encode(
                        &base64::engine::general_purpose::STANDARD,
                        &data,
                    );
                    let audio_msg = AudioInput {
                        msg_type: "input_audio_buffer.append".to_string(),
                        audio: audio_b64,
                    };
                    if let Err(e) = vllm_sink
                        .send(TungMessage::Text(serde_json::to_string(&audio_msg).unwrap().into()))
                        .await
                    {
                        tracing::error!(error = %e, "Failed to forward binary audio to vLLM");
                        break;
                    }
                }
                Ok(Message::Close(_)) => {
                    tracing::info!("Client closed WebSocket connection");
                    break;
                }
                Err(e) => {
                    tracing::error!(error = %e, "Error receiving from client");
                    break;
                }
                _ => {}
            }
        }
    };

    // Spawn task to forward vLLM transcriptions to client
    let vllm_to_client = async move {
        while let Some(msg) = vllm_stream.next().await {
            match msg {
                Ok(TungMessage::Text(text)) => {
                    if let Ok(response) = serde_json::from_str::<VllmResponse>(&text) {
                        // Handle different response types
                        let client_msg = match response.msg_type.as_str() {
                            "conversation.item.input_audio_transcription.completed" => {
                                response.transcript.map(ClientMessage::transcript)
                            }
                            "response.audio_transcript.delta" => {
                                response.delta
                                    .and_then(|d| d.transcript)
                                    .map(ClientMessage::transcript)
                            }
                            "error" => {
                                response.error.map(|e| ClientMessage::error(e.message))
                            }
                            _ => None,
                        };

                        if let Some(msg) = client_msg {
                            if let Err(e) = client_sink
                                .send(Message::Text(serde_json::to_string(&msg).unwrap().into()))
                                .await
                            {
                                tracing::error!(error = %e, "Failed to send transcript to client");
                                break;
                            }
                        }
                    }
                }
                Ok(TungMessage::Close(_)) => {
                    tracing::info!("vLLM closed WebSocket connection");
                    break;
                }
                Err(e) => {
                    tracing::error!(error = %e, "Error receiving from vLLM");
                    break;
                }
                _ => {}
            }
        }
    };

    // Run both tasks concurrently
    tokio::select! {
        _ = client_to_vllm => {
            tracing::info!("Client-to-vLLM task completed");
        }
        _ = vllm_to_client => {
            tracing::info!("vLLM-to-client task completed");
        }
    }

    tracing::info!(user = %user.username, "WebSocket session ended");
}
