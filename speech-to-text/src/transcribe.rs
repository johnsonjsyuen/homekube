//! WebSocket handler for real-time speech-to-text transcription.
//!
//! This module handles WebSocket communication with the browser client,
//! buffering audio and sending to Whisper HTTP API for transcription.

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

/// Request to Whisper transcription API
#[derive(Debug, Serialize)]
struct WhisperRequest {
    audio: String, // base64 encoded PCM16 audio
    language: String,
}

/// Response from Whisper transcription API
#[derive(Debug, Deserialize)]
struct WhisperResponse {
    text: String,
    #[serde(default)]
    segments: Vec<TranscriptSegment>,
}

#[derive(Debug, Deserialize)]
struct TranscriptSegment {
    start: f32,
    end: f32,
    text: String,
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

    let (mut client_sink, mut client_stream) = socket.split();

    // Notify client that connection is ready
    let connected_msg = ClientMessage::connected();
    if let Err(e) = client_sink
        .send(Message::Text(serde_json::to_string(&connected_msg).unwrap().into()))
        .await
    {
        tracing::error!(error = %e, "Failed to send connected message to client");
        return;
    }

    // Buffer for accumulating audio data
    let mut audio_buffer: Vec<u8> = Vec::new();
    let http_client = reqwest::Client::new();
    let whisper_url = format!("{}/transcribe", state.whisper_url);

    // Process messages from client
    while let Some(msg) = client_stream.next().await {
        match msg {
            Ok(Message::Text(text)) => {
                // Client sends JSON with audio data or commit signal
                if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&text) {
                    if let Some(audio_data) = parsed.get("audio").and_then(|v| v.as_str()) {
                        // Decode base64 audio and append to buffer
                        if let Ok(decoded) = base64::Engine::decode(
                            &base64::engine::general_purpose::STANDARD,
                            audio_data,
                        ) {
                            audio_buffer.extend(decoded);
                            tracing::debug!(buffer_size = audio_buffer.len(), "Audio chunk received");
                        }
                    } else if parsed.get("type").and_then(|v| v.as_str()) == Some("commit") {
                        // Client signals end of audio - send to Whisper for transcription
                        tracing::info!(buffer_size = audio_buffer.len(), "Commit received, sending to Whisper");
                        if !audio_buffer.is_empty() {
                            let audio_b64 = base64::Engine::encode(
                                &base64::engine::general_purpose::STANDARD,
                                &audio_buffer,
                            );

                            let request = WhisperRequest {
                                audio: audio_b64,
                                language: "en".to_string(),
                            };

                            match http_client
                                .post(&whisper_url)
                                .json(&request)
                                .send()
                                .await
                            {
                                Ok(response) => {
                                    tracing::info!(status = %response.status(), "Whisper response received");
                                    if response.status().is_success() {
                                        match response.json::<WhisperResponse>().await {
                                            Ok(whisper_response) => {
                                                tracing::info!(text_len = whisper_response.text.len(), text = %whisper_response.text, "Transcription result");
                                                if !whisper_response.text.is_empty() {
                                                    let msg = ClientMessage::transcript(
                                                        whisper_response.text,
                                                    );
                                                    if let Err(e) = client_sink
                                                        .send(Message::Text(
                                                            serde_json::to_string(&msg)
                                                                .unwrap()
                                                                .into(),
                                                        ))
                                                        .await
                                                    {
                                                        tracing::error!(
                                                            error = %e,
                                                            "Failed to send transcript to client"
                                                        );
                                                        break;
                                                    }
                                                    tracing::info!("Transcript sent to client");
                                                }
                                            }
                                            Err(e) => {
                                                tracing::error!(
                                                    error = %e,
                                                    "Failed to parse Whisper response"
                                                );
                                            }
                                        }
                                    } else {
                                        tracing::error!(
                                            status = %response.status(),
                                            "Whisper API error"
                                        );
                                    }
                                }
                                Err(e) => {
                                    tracing::error!(error = %e, "Failed to call Whisper API");
                                    let msg = ClientMessage::error(format!(
                                        "Transcription failed: {}",
                                        e
                                    ));
                                    let _ = client_sink
                                        .send(Message::Text(
                                            serde_json::to_string(&msg).unwrap().into(),
                                        ))
                                        .await;
                                }
                            }

                            // Clear buffer after processing
                            audio_buffer.clear();
                        }
                    }
                }
            }
            Ok(Message::Binary(data)) => {
                // Direct binary audio data - append to buffer
                audio_buffer.extend(data.to_vec());
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

    tracing::info!(user = %user.username, "WebSocket session ended");
}
