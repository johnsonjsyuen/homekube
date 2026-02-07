//! WebSocket handler for real-time TTS streaming.
//!
//! This module provides a WebSocket endpoint for live TTS synthesis with
//! audio streaming and word timing information.

use crate::auth::validate_token_public;
use crate::inference::SAMPLE_RATE;
use crate::phonemizer::{estimate_word_timings, phonemize, split_sentences};
use crate::state::AppState;

use axum::{
    extract::{
        State,
        ws::{Message, WebSocket, WebSocketUpgrade},
    },
    response::Response,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::watch;

/// Client to server message types
#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum ClientMessage {
    Auth {
        token: String,
    },
    Synthesize {
        text: String,
        voice: String,
        speed: f32,
    },
    SynthesizeAppend {
        text: String,
        voice: String,
        speed: f32,
    },
    Stop,
}

/// Server to client message types
#[derive(Debug, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum ServerMessage {
    AuthOk {
        username: String,
    },
    AuthError {
        message: String,
    },
    WordTiming {
        sentence_index: u32,
        words: Vec<WordInfo>,
    },
    SentenceDone {
        sentence_index: u32,
    },
    Done,
    Error {
        message: String,
    },
    Stopped,
}

#[derive(Debug, Serialize)]
struct WordInfo {
    word: String,
    start_ms: u32,
    end_ms: u32,
}

/// WebSocket upgrade handler
pub async fn ws_live_handler(ws: WebSocketUpgrade, State(state): State<AppState>) -> Response {
    ws.on_upgrade(move |socket| handle_connection(socket, state))
}

async fn handle_connection(mut socket: WebSocket, state: AppState) {
    tracing::info!("New WebSocket connection for live TTS");

    // First message must be auth
    let username = match wait_for_auth(&mut socket, &state).await {
        Ok(username) => username,
        Err(e) => {
            let _ = send_message(&mut socket, &ServerMessage::AuthError { message: e }).await;
            return;
        }
    };

    tracing::info!(username = %username, "WebSocket authenticated");
    if send_message(
        &mut socket,
        &ServerMessage::AuthOk {
            username: username.clone(),
        },
    )
    .await
    .is_err()
    {
        return;
    }

    // Create stop signal channel
    let (stop_tx, _stop_rx) = watch::channel(false);

    // Sentence counter persists across append messages
    let mut sentence_counter: u32 = 0;
    // Buffer for incomplete text (text that hasn't ended with sentence-ending punctuation)
    let mut pending_text = String::new();

    // Main message loop
    loop {
        let msg = match socket.recv().await {
            Some(Ok(msg)) => msg,
            Some(Err(e)) => {
                tracing::error!("WebSocket receive error: {}", e);
                break;
            }
            None => {
                tracing::info!("WebSocket closed");
                break;
            }
        };

        match msg {
            Message::Text(text) => {
                match serde_json::from_str::<ClientMessage>(&text) {
                    Ok(ClientMessage::Synthesize { text, voice, speed }) => {
                        // Full synthesize: reset state and process entire text
                        sentence_counter = 0;
                        pending_text.clear();
                        let stop_rx = stop_tx.subscribe();
                        if let Err(e) =
                            handle_synthesize(&mut socket, &state, &text, &voice, speed, stop_rx, &mut sentence_counter)
                                .await
                        {
                            let _ = send_message(&mut socket, &ServerMessage::Error { message: e })
                                .await;
                        }
                    }
                    Ok(ClientMessage::SynthesizeAppend { text, voice, speed }) => {
                        // Append new text and synthesize only complete sentences
                        pending_text.push_str(&text);

                        // Split into sentences and keep the last fragment if incomplete
                        let sentences = split_sentences(&pending_text);
                        if sentences.is_empty() {
                            continue;
                        }

                        // Check if the pending text ends with sentence-ending punctuation
                        let trimmed = pending_text.trim_end();
                        let ends_with_sentence = trimmed.ends_with('.')
                            || trimmed.ends_with('!')
                            || trimmed.ends_with('?')
                            || trimmed.ends_with(':')
                            || trimmed.ends_with(';');

                        let (to_speak, leftover) = if ends_with_sentence {
                            // All sentences are complete
                            (sentences, String::new())
                        } else if sentences.len() > 1 {
                            // Last sentence is incomplete, speak all but the last
                            let mut complete = sentences;
                            let last = complete.pop().unwrap_or_default();
                            (complete, last)
                        } else {
                            // Only one incomplete sentence, wait for more
                            continue;
                        };

                        pending_text = leftover;

                        if !to_speak.is_empty() {
                            let stop_rx = stop_tx.subscribe();
                            let combined = to_speak.join(" ");
                            if let Err(e) = handle_synthesize(
                                &mut socket,
                                &state,
                                &combined,
                                &voice,
                                speed,
                                stop_rx,
                                &mut sentence_counter,
                            )
                            .await
                            {
                                let _ = send_message(
                                    &mut socket,
                                    &ServerMessage::Error { message: e },
                                )
                                .await;
                            }
                        }
                    }
                    Ok(ClientMessage::Stop) => {
                        let _ = stop_tx.send(true);
                        pending_text.clear();
                        let _ = send_message(&mut socket, &ServerMessage::Stopped).await;
                    }
                    Ok(ClientMessage::Auth { .. }) => {
                        // Already authenticated, ignore
                    }
                    Err(e) => {
                        tracing::warn!("Invalid message: {}", e);
                        let _ = send_message(
                            &mut socket,
                            &ServerMessage::Error {
                                message: format!("Invalid message: {}", e),
                            },
                        )
                        .await;
                    }
                }
            }
            Message::Binary(_) => {
                // Client shouldn't send binary, ignore
            }
            Message::Close(_) => {
                tracing::info!("WebSocket close requested");
                break;
            }
            _ => {}
        }
    }
}

async fn wait_for_auth(socket: &mut WebSocket, state: &AppState) -> Result<String, String> {
    // Wait for auth message with timeout
    let timeout = tokio::time::Duration::from_secs(10);

    let msg = tokio::time::timeout(timeout, socket.recv())
        .await
        .map_err(|_| "Auth timeout")?
        .ok_or("Connection closed")?
        .map_err(|e| format!("Receive error: {}", e))?;

    let text = match msg {
        Message::Text(t) => t,
        _ => return Err("First message must be text".to_string()),
    };

    let client_msg: ClientMessage =
        serde_json::from_str(&text).map_err(|e| format!("Invalid auth message: {}", e))?;

    match client_msg {
        ClientMessage::Auth { token } => {
            // Strip "Bearer " prefix if present
            let token = token.strip_prefix("Bearer ").unwrap_or(&token);
            validate_token_public(state, token).await
        }
        _ => Err("First message must be auth".to_string()),
    }
}

async fn handle_synthesize(
    socket: &mut WebSocket,
    state: &AppState,
    text: &str,
    voice: &str,
    speed: f32,
    stop_rx: watch::Receiver<bool>,
    sentence_counter: &mut u32,
) -> Result<(), String> {
    let model = state.kokoro_model.as_ref().ok_or("TTS model not loaded")?;

    // Split text into sentences
    let sentences = split_sentences(text);

    for sentence in sentences.iter() {
        let sentence_idx = *sentence_counter;
        *sentence_counter += 1;

        // Check for stop signal
        if *stop_rx.borrow() {
            return Ok(());
        }

        // Phonemize the sentence (blocking operation)
        let phonemes = {
            let sentence = sentence.clone();
            tokio::task::spawn_blocking(move || phonemize(&sentence, "en"))
                .await
                .map_err(|e| format!("Phonemize task failed: {}", e))?
                .map_err(|e| format!("Phonemization failed: {}", e))?
        };

        if phonemes.is_empty() {
            continue;
        }

        // Run synthesis in blocking task
        let model_clone = Arc::clone(model);
        let phonemes_clone = phonemes.clone();
        let voice_clone = voice.to_string();

        let audio = tokio::task::spawn_blocking(move || {
            model_clone.synthesize(&phonemes_clone, &voice_clone, speed)
        })
        .await
        .map_err(|e| format!("Synthesis task failed: {}", e))?
        .map_err(|e| format!("Synthesis failed: {}", e))?;

        if audio.is_empty() {
            continue;
        }

        // Estimate word timings
        let word_timings = estimate_word_timings(sentence, &phonemes, audio.len(), SAMPLE_RATE);

        // Send word timing info
        let words: Vec<WordInfo> = word_timings
            .into_iter()
            .map(|(word, start_ms, end_ms)| WordInfo {
                word,
                start_ms,
                end_ms,
            })
            .collect();

        send_message(
            socket,
            &ServerMessage::WordTiming {
                sentence_index: sentence_idx,
                words,
            },
        )
        .await?;

        // Stream audio in chunks (~100ms per chunk)
        let chunk_samples = (SAMPLE_RATE as usize / 10).max(1); // 100ms = 2400 samples at 24kHz

        for chunk in audio.chunks(chunk_samples) {
            // Check for stop signal
            if *stop_rx.borrow() {
                return Ok(());
            }

            // Binary format: [4 bytes sentence_index u32 LE][PCM f32le samples]
            let mut data = Vec::with_capacity(4 + chunk.len() * 4);
            data.extend_from_slice(&(sentence_idx as u32).to_le_bytes());
            for sample in chunk {
                data.extend_from_slice(&sample.to_le_bytes());
            }

            socket
                .send(Message::Binary(data.into()))
                .await
                .map_err(|e| format!("Failed to send audio: {}", e))?;

            // Small delay to avoid overwhelming the client
            tokio::time::sleep(tokio::time::Duration::from_millis(10)).await;
        }

        // Sentence complete
        send_message(
            socket,
            &ServerMessage::SentenceDone {
                sentence_index: sentence_idx,
            },
        )
        .await?;
    }

    // All done for this batch
    send_message(socket, &ServerMessage::Done).await?;

    Ok(())
}

async fn send_message(socket: &mut WebSocket, msg: &ServerMessage) -> Result<(), String> {
    let json =
        serde_json::to_string(msg).map_err(|e| format!("Failed to serialize message: {}", e))?;

    socket
        .send(Message::Text(json.into()))
        .await
        .map_err(|e| format!("Failed to send message: {}", e))
}
