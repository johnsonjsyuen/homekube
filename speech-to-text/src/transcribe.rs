//! WebSocket handler for real-time streaming speech-to-text transcription.
//!
//! This module handles WebSocket communication with the browser client,
//! using VAD-based segmentation and double buffering for continuous streaming.

use crate::auth::{extract_token_from_query, validate_ws_token};
use crate::state::AppState;
use crate::vad::{VadConfig, VadEvent, VadState};
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
use std::sync::Arc;
use tokio::sync::mpsc;

/// Request to Whisper transcription API
#[derive(Debug, Serialize)]
struct WhisperRequest {
    audio: String, // base64 encoded PCM16 audio
    language: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    initial_prompt: Option<String>,
}

/// Response from Whisper transcription API
#[derive(Debug, Deserialize)]
struct WhisperResponse {
    text: String,
    #[serde(default)]
    segments: Vec<TranscriptSegment>,
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
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
    #[serde(skip_serializing_if = "Option::is_none")]
    is_final: Option<bool>,
}

impl ClientMessage {
    fn transcript(text: String, is_final: bool) -> Self {
        Self {
            msg_type: "transcript".to_string(),
            text: Some(text),
            error: None,
            is_final: Some(is_final),
        }
    }

    fn error(msg: String) -> Self {
        Self {
            msg_type: "error".to_string(),
            text: None,
            error: Some(msg),
            is_final: None,
        }
    }

    fn connected() -> Self {
        Self {
            msg_type: "connected".to_string(),
            text: None,
            error: None,
            is_final: None,
        }
    }
}

/// Segment of audio to be transcribed
struct AudioSegment {
    /// PCM16 audio data
    data: Vec<u8>,
    /// Whether this is the final segment (recording stopped)
    is_final: bool,
    /// Recent transcript text to condition Whisper for better accuracy
    initial_prompt: Option<String>,
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

    let (client_sink, mut client_stream) = socket.split();
    let client_sink = Arc::new(tokio::sync::Mutex::new(client_sink));

    // Notify client that connection is ready
    {
        let mut sink = client_sink.lock().await;
        let connected_msg = ClientMessage::connected();
        if let Err(e) = sink
            .send(Message::Text(serde_json::to_string(&connected_msg).unwrap().into()))
            .await
        {
            tracing::error!(error = %e, "Failed to send connected message to client");
            return;
        }
    }

    // Channel for sending audio segments to transcription task
    let (segment_tx, segment_rx) = mpsc::channel::<AudioSegment>(4);

    // Spawn transcription background task
    let transcription_sink = Arc::clone(&client_sink);
    let whisper_url = format!("{}/transcribe", state.whisper_url);
    let http_client = reqwest::Client::new();
    
    let transcription_task = tokio::spawn(async move {
        transcription_worker(segment_rx, transcription_sink, http_client, whisper_url).await;
    });

    // VAD configuration
    let vad_config = VadConfig::default();
    let mut vad = VadState::new(vad_config);

    // Double buffer: active buffer collects audio, ready buffer is sent for transcription
    let mut active_buffer: Vec<u8> = Vec::new();

    // Track the latest initial_prompt from the frontend for Whisper conditioning
    let mut initial_prompt: Option<String> = None;
    
    // Overlap buffer - keep last ~0.5s for context between segments
    const OVERLAP_SAMPLES: usize = 16000 / 2; // 0.5s at 16kHz
    const OVERLAP_BYTES: usize = OVERLAP_SAMPLES * 2; // PCM16 = 2 bytes per sample

    // Process messages from client
    while let Some(msg) = client_stream.next().await {
        match msg {
            Ok(Message::Text(text)) => {
                // Client sends JSON with audio data or control signals
                if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&text) {
                    if let Some(audio_data) = parsed.get("audio").and_then(|v| v.as_str()) {
                        // Update initial_prompt from frontend if provided
                        if let Some(prompt) = parsed.get("initial_prompt").and_then(|v| v.as_str()) {
                            initial_prompt = if prompt.is_empty() {
                                None
                            } else {
                                Some(prompt.to_string())
                            };
                        }

                        // Decode base64 audio and append to buffer
                        if let Ok(decoded) = base64::Engine::decode(
                            &base64::engine::general_purpose::STANDARD,
                            audio_data,
                        ) {
                            // Convert bytes to i16 samples for VAD
                            let samples: Vec<i16> = decoded
                                .chunks_exact(2)
                                .map(|c| i16::from_le_bytes([c[0], c[1]]))
                                .collect();

                            // Process through VAD
                            let event = vad.process(&samples);

                            // Always add to active buffer while speaking or during grace period
                            if event == VadEvent::Speaking 
                                || event == VadEvent::SpeechEnded 
                                || event == VadEvent::MaxDurationReached 
                            {
                                active_buffer.extend(&decoded);
                            }

                            // Check if we should send for transcription
                            match event {
                                VadEvent::SpeechEnded | VadEvent::MaxDurationReached => {
                                    if !active_buffer.is_empty() {
                                        let segment = AudioSegment {
                                            data: active_buffer.clone(),
                                            is_final: false,
                                            initial_prompt: initial_prompt.clone(),
                                        };

                                        if let Err(e) = segment_tx.send(segment).await {
                                            tracing::error!(error = %e, "Failed to send segment for transcription");
                                        }

                                        // Keep overlap for context
                                        if active_buffer.len() > OVERLAP_BYTES {
                                            active_buffer = active_buffer.split_off(active_buffer.len() - OVERLAP_BYTES);
                                        } else {
                                            active_buffer.clear();
                                        }
                                    }
                                }
                                _ => {}
                            }
                        }
                    } else if parsed.get("type").and_then(|v| v.as_str()) == Some("commit") {
                        // Client signals end of recording - send any remaining audio
                        tracing::info!(buffer_size = active_buffer.len(), "Commit received");
                        if !active_buffer.is_empty() {
                            let segment = AudioSegment {
                                data: std::mem::take(&mut active_buffer),
                                is_final: true,
                                initial_prompt: initial_prompt.clone(),
                            };

                            if let Err(e) = segment_tx.send(segment).await {
                                tracing::error!(error = %e, "Failed to send final segment");
                            }
                        }
                        vad.reset();
                    }
                }
            }
            Ok(Message::Binary(data)) => {
                // Direct binary audio data
                let samples: Vec<i16> = data
                    .chunks_exact(2)
                    .map(|c| i16::from_le_bytes([c[0], c[1]]))
                    .collect();

                let event = vad.process(&samples);

                if event == VadEvent::Speaking 
                    || event == VadEvent::SpeechEnded 
                    || event == VadEvent::MaxDurationReached 
                {
                    active_buffer.extend(data.to_vec());
                }

                if matches!(event, VadEvent::SpeechEnded | VadEvent::MaxDurationReached) {
                    if !active_buffer.is_empty() {
                        let segment = AudioSegment {
                            data: active_buffer.clone(),
                            is_final: false,
                            initial_prompt: initial_prompt.clone(),
                        };

                        if let Err(e) = segment_tx.send(segment).await {
                            tracing::error!(error = %e, "Failed to send segment");
                        }

                        if active_buffer.len() > OVERLAP_BYTES {
                            active_buffer = active_buffer.split_off(active_buffer.len() - OVERLAP_BYTES);
                        } else {
                            active_buffer.clear();
                        }
                    }
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

    // Clean up
    drop(segment_tx);
    let _ = transcription_task.await;

    tracing::info!(user = %user.username, "WebSocket session ended");
}

/// Background worker that processes audio segments and sends transcriptions
async fn transcription_worker(
    mut segment_rx: mpsc::Receiver<AudioSegment>,
    client_sink: Arc<tokio::sync::Mutex<futures_util::stream::SplitSink<WebSocket, Message>>>,
    http_client: reqwest::Client,
    whisper_url: String,
) {
    while let Some(segment) = segment_rx.recv().await {
        let audio_b64 = base64::Engine::encode(
            &base64::engine::general_purpose::STANDARD,
            &segment.data,
        );

        let request = WhisperRequest {
            audio: audio_b64,
            language: "en".to_string(),
            initial_prompt: segment.initial_prompt.clone(),
        };

        tracing::info!(
            size_bytes = segment.data.len(),
            is_final = segment.is_final,
            "Sending segment to Whisper"
        );

        match http_client.post(&whisper_url).json(&request).send().await {
            Ok(response) => {
                if response.status().is_success() {
                    match response.json::<WhisperResponse>().await {
                        Ok(whisper_response) => {
                            let text = whisper_response.text.trim().to_string();
                            if !text.is_empty() {
                                let msg = ClientMessage::transcript(text.clone(), segment.is_final);
                                let mut sink = client_sink.lock().await;
                                if let Err(e) = sink
                                    .send(Message::Text(serde_json::to_string(&msg).unwrap().into()))
                                    .await
                                {
                                    tracing::error!(error = %e, "Failed to send transcript to client");
                                    break;
                                }
                                tracing::info!(
                                    text = %text,
                                    is_final = segment.is_final,
                                    "Transcript sent to client"
                                );
                            }
                        }
                        Err(e) => {
                            tracing::error!(error = %e, "Failed to parse Whisper response");
                        }
                    }
                } else {
                    tracing::error!(status = %response.status(), "Whisper API error");
                }
            }
            Err(e) => {
                tracing::error!(error = %e, "Failed to call Whisper API");
                let msg = ClientMessage::error(format!("Transcription failed: {}", e));
                let mut sink = client_sink.lock().await;
                let _ = sink
                    .send(Message::Text(serde_json::to_string(&msg).unwrap().into()))
                    .await;
            }
        }
    }

    tracing::debug!("Transcription worker shutting down");
}
