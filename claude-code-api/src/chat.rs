use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::State;
use axum::response::IntoResponse;
use futures::{SinkExt, StreamExt};
use serde_json::json;
use sqlx::PgPool;
use std::sync::Arc;
use tokio::sync::broadcast;
use uuid::Uuid;

use crate::auth::{JwksCache, UserClaims};
use crate::claude;

// ---------------------------------------------------------------------------
// Broadcast event for cross-window synchronization
// ---------------------------------------------------------------------------

#[derive(Clone, Debug)]
pub struct BroadcastEvent {
    pub source: Uuid,
    pub payload: String,
}

fn get_user_channel(state: &crate::AppState, user_id: &str) -> broadcast::Sender<BroadcastEvent> {
    let mut channels = state.user_channels.lock().unwrap_or_else(|e| e.into_inner());
    channels
        .entry(user_id.to_string())
        .or_insert_with(|| broadcast::channel(256).0)
        .clone()
}

// ---------------------------------------------------------------------------
// Handler — upgrades HTTP to WebSocket
// ---------------------------------------------------------------------------

pub async fn ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<Arc<crate::AppState>>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_socket(socket, state))
}

// ---------------------------------------------------------------------------
// WebSocket session
// ---------------------------------------------------------------------------

async fn handle_socket(socket: WebSocket, state: Arc<crate::AppState>) {
    let (mut sender, mut receiver) = socket.split();

    // --- Auth: first message must be an auth token within 10 seconds. ---
    let claims = match tokio::time::timeout(
        std::time::Duration::from_secs(10),
        wait_for_auth(&mut receiver, &state.jwks),
    )
    .await
    {
        Ok(Ok(claims)) => claims,
        Ok(Err(msg)) => {
            let _ = sender
                .send(Message::Text(
                    json!({"type": "auth_error", "message": msg}).to_string().into(),
                ))
                .await;
            return;
        }
        Err(_) => {
            let _ = sender
                .send(Message::Text(
                    json!({"type": "auth_error", "message": "auth timeout"})
                        .to_string().into(),
                ))
                .await;
            return;
        }
    };

    // Send auth_ok.
    let _ = sender
        .send(Message::Text(
            json!({
                "type": "auth_ok",
                "user_id": claims.user_id,
                "username": claims.username,
            })
            .to_string().into(),
        ))
        .await;

    tracing::info!(user_id = %claims.user_id, "WebSocket authenticated");

    // --- Cross-window broadcast setup ---
    let connection_id = Uuid::new_v4();
    let broadcast_tx = get_user_channel(&state, &claims.user_id);
    let mut broadcast_rx = broadcast_tx.subscribe();

    // --- Message loop with keepalive pings ---
    let mut ping_interval = tokio::time::interval(std::time::Duration::from_secs(30));
    ping_interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);

    loop {
        tokio::select! {
            msg = receiver.next() => {
                let msg = match msg {
                    Some(Ok(m)) => m,
                    _ => break,
                };

                let text = match msg {
                    Message::Text(t) => t.to_string(),
                    Message::Close(_) => break,
                    _ => continue,
                };

                let parsed: serde_json::Value = match serde_json::from_str(&text) {
                    Ok(v) => v,
                    Err(_) => {
                        let _ = send_error(&mut sender, "invalid JSON").await;
                        continue;
                    }
                };

                let msg_type = parsed
                    .get("type")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");

                let result = match msg_type {
                    "list_conversations" => {
                        handle_list_conversations(&mut sender, &state.pool, &claims).await
                    }
                    "create_conversation" => {
                        let title = parsed
                            .get("title")
                            .and_then(|v| v.as_str())
                            .unwrap_or("New conversation");
                        handle_create_conversation(&mut sender, &state.pool, &claims, title, &broadcast_tx, connection_id).await
                    }
                    "load_conversation" => {
                        let id_str = parsed.get("id").and_then(|v| v.as_str()).unwrap_or("");
                        handle_load_conversation(&mut sender, &state.pool, &claims, id_str).await
                    }
                    "send_message" => {
                        let conv_id_str = parsed
                            .get("conversation_id")
                            .and_then(|v| v.as_str())
                            .unwrap_or("");
                        let content = parsed
                            .get("content")
                            .and_then(|v| v.as_str())
                            .unwrap_or("");
                        handle_send_message(
                            &mut sender,
                            &state,
                            &claims,
                            conv_id_str,
                            content,
                            &broadcast_tx,
                            connection_id,
                        )
                        .await
                    }
                    "delete_conversation" => {
                        let id_str = parsed.get("id").and_then(|v| v.as_str()).unwrap_or("");
                        handle_delete_conversation(&mut sender, &state.pool, &claims, id_str, &broadcast_tx, connection_id).await
                    }
                    _ => {
                        let _ = send_error(&mut sender, &format!("unknown message type: {msg_type}")).await;
                        Ok(())
                    }
                };

                if let Err(e) = result {
                    tracing::error!(error = %e, "WebSocket handler error");
                    break;
                }
            }
            _ = ping_interval.tick() => {
                if sender.send(Message::Ping(vec![].into())).await.is_err() {
                    tracing::warn!(user_id = %claims.user_id, "keepalive ping failed");
                    break;
                }
            }
            event = broadcast_rx.recv() => {
                if let Ok(event) = event {
                    if event.source != connection_id {
                        if sender.send(Message::Text(event.payload.into())).await.is_err() {
                            break;
                        }
                    }
                }
            }
        }
    }

    // Clean up broadcast channel if no other connections remain for this user
    {
        let mut channels = state.user_channels.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(tx) = channels.get(&claims.user_id) {
            if tx.receiver_count() == 0 {
                channels.remove(&claims.user_id);
            }
        }
    }

    tracing::info!(user_id = %claims.user_id, "WebSocket disconnected");
}

// ---------------------------------------------------------------------------
// Auth helper
// ---------------------------------------------------------------------------

async fn wait_for_auth(
    receiver: &mut (impl StreamExt<Item = Result<Message, axum::Error>> + Unpin),
    jwks: &JwksCache,
) -> Result<UserClaims, String> {
    while let Some(Ok(msg)) = receiver.next().await {
        let text = match msg {
            Message::Text(t) => t.to_string(),
            Message::Close(_) => return Err("connection closed".to_string()),
            _ => continue,
        };

        let parsed: serde_json::Value =
            serde_json::from_str(&text).map_err(|_| "invalid JSON".to_string())?;

        let msg_type = parsed
            .get("type")
            .and_then(|v| v.as_str())
            .unwrap_or("");

        if msg_type != "auth" {
            return Err("first message must be auth".to_string());
        }

        let token = parsed
            .get("token")
            .and_then(|v| v.as_str())
            .unwrap_or("");

        // Strip "Bearer " prefix if present.
        let token = token.strip_prefix("Bearer ").unwrap_or(token);
        if token.is_empty() {
            return Err("missing token".to_string());
        }

        return jwks.validate(token).await;
    }

    Err("connection closed before auth".to_string())
}

// ---------------------------------------------------------------------------
// Message handlers
// ---------------------------------------------------------------------------

type WsSender = futures::stream::SplitSink<WebSocket, Message>;
type HandlerResult = Result<(), axum::Error>;

async fn send_error(sender: &mut WsSender, message: &str) -> HandlerResult {
    sender
        .send(Message::Text(
            json!({"type": "error", "message": message}).to_string().into(),
        ))
        .await
        .map_err(Into::into)
}

async fn handle_list_conversations(
    sender: &mut WsSender,
    pool: &PgPool,
    claims: &UserClaims,
) -> HandlerResult {
    match crate::db::list_conversations(pool, &claims.user_id).await {
        Ok(conversations) => {
            let data: Vec<serde_json::Value> = conversations
                .iter()
                .map(|c| {
                    json!({
                        "id": c.id,
                        "title": c.title,
                        "updated_at": c.updated_at,
                    })
                })
                .collect();

            sender
                .send(Message::Text(
                    json!({"type": "conversations", "data": data})
                        .to_string().into(),
                ))
                .await?;
        }
        Err(e) => {
            tracing::error!(error = %e, "failed to list conversations");
            send_error(sender, "failed to list conversations").await?;
        }
    }
    Ok(())
}

async fn handle_create_conversation(
    sender: &mut WsSender,
    pool: &PgPool,
    claims: &UserClaims,
    title: &str,
    broadcast_tx: &broadcast::Sender<BroadcastEvent>,
    connection_id: Uuid,
) -> HandlerResult {
    match crate::db::create_conversation(pool, &claims.user_id, title).await {
        Ok(conv) => {
            sender
                .send(Message::Text(
                    json!({
                        "type": "conversation_created",
                        "id": conv.id,
                        "title": conv.title,
                    })
                    .to_string().into(),
                ))
                .await?;

            let _ = broadcast_tx.send(BroadcastEvent {
                source: connection_id,
                payload: json!({
                    "type": "conversations_changed",
                })
                .to_string(),
            });
        }
        Err(e) => {
            tracing::error!(error = %e, "failed to create conversation");
            send_error(sender, "failed to create conversation").await?;
        }
    }
    Ok(())
}

async fn handle_load_conversation(
    sender: &mut WsSender,
    pool: &PgPool,
    claims: &UserClaims,
    id_str: &str,
) -> HandlerResult {
    let id = match Uuid::parse_str(id_str) {
        Ok(id) => id,
        Err(_) => {
            send_error(sender, "invalid conversation id").await?;
            return Ok(());
        }
    };

    // Verify ownership.
    let conv = match crate::db::get_conversation(pool, id, &claims.user_id).await {
        Ok(Some(c)) => c,
        Ok(None) => {
            send_error(sender, "conversation not found").await?;
            return Ok(());
        }
        Err(e) => {
            tracing::error!(error = %e, "failed to get conversation");
            send_error(sender, "failed to load conversation").await?;
            return Ok(());
        }
    };

    let messages = match crate::db::get_messages(pool, conv.id).await {
        Ok(m) => m,
        Err(e) => {
            tracing::error!(error = %e, "failed to get messages");
            send_error(sender, "failed to load messages").await?;
            return Ok(());
        }
    };

    let msg_data: Vec<serde_json::Value> = messages
        .iter()
        .map(|m| {
            json!({
                "id": m.id,
                "role": m.role,
                "content": m.content,
                "created_at": m.created_at,
            })
        })
        .collect();

    sender
        .send(Message::Text(
            json!({
                "type": "conversation_loaded",
                "id": conv.id,
                "messages": msg_data,
            })
            .to_string().into(),
        ))
        .await?;
    Ok(())
}

async fn handle_send_message(
    sender: &mut WsSender,
    state: &crate::AppState,
    claims: &UserClaims,
    conv_id_str: &str,
    content: &str,
    broadcast_tx: &broadcast::Sender<BroadcastEvent>,
    connection_id: Uuid,
) -> HandlerResult {
    let pool = &state.pool;
    let nats = state.nats.as_ref();
    let conversation_id = match Uuid::parse_str(conv_id_str) {
        Ok(id) => id,
        Err(_) => {
            send_error(sender, "invalid conversation_id").await?;
            return Ok(());
        }
    };

    if content.is_empty() {
        send_error(sender, "content is required").await?;
        return Ok(());
    }

    // Verify ownership.
    let _conv = match crate::db::get_conversation(pool, conversation_id, &claims.user_id).await {
        Ok(Some(c)) => c,
        Ok(None) => {
            send_error(sender, "conversation not found").await?;
            return Ok(());
        }
        Err(e) => {
            tracing::error!(error = %e, "failed to get conversation");
            send_error(sender, "database error").await?;
            return Ok(());
        }
    };

    // 1. Save user message to DB.
    if let Err(e) = crate::db::insert_message(pool, conversation_id, "user", content).await {
        tracing::error!(error = %e, "failed to save user message");
        send_error(sender, "failed to save message").await?;
        return Ok(());
    }

    // 2. Publish user message to NATS (best-effort).
    if let Some(nats) = nats {
        let conv_id_str = conversation_id.to_string();
        if let Err(e) = nats
            .publish_chat_message(&claims.user_id, &conv_id_str, "user", content)
            .await
        {
            tracing::warn!(error = %e, "failed to publish user message to NATS");
        }
    }

    // 3. Acquire semaphore to limit concurrent Claude invocations.
    let _permit = state.semaphore.acquire().await.expect("semaphore closed");

    // Build prompt with conversation history for context.
    // (--resume doesn't work with -p mode, so we pass full history each time)
    let history = match crate::db::get_messages(pool, conversation_id).await {
        Ok(msgs) => msgs,
        Err(e) => {
            tracing::error!(error = %e, "failed to load conversation history");
            send_error(sender, "failed to load history").await?;
            return Ok(());
        }
    };

    let mut prompt = String::new();
    if history.len() > 1 {
        prompt.push_str("Here is the conversation so far:\n\n");
        for msg in &history {
            let role_label = if msg.role == "user" { "User" } else { "Assistant" };
            prompt.push_str(&format!("{role_label}: {}\n\n", msg.content));
        }
        prompt.push_str("Continue the conversation. Respond to the latest user message above.");
    } else {
        // First message — no history needed
        prompt.push_str(content);
    }

    let content_owned = prompt;

    // We need to collect stream lines and forward them over the WebSocket.
    // Use a channel so the callback (sync) can send to the async sender.
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<String>();

    let claude_handle = tokio::spawn(async move {
        claude::invoke_claude_streaming(
            &content_owned,
            None, // --resume not supported in -p mode; we pass history in prompt
            move |line| {
                let _ = tx.send(line);
            },
        )
        .await
    });

    // Forward streaming lines to the WebSocket client, with keepalive pings
    // to prevent Cloudflare tunnel idle timeout during long Claude responses.
    let mut stream_ping_interval = tokio::time::interval(std::time::Duration::from_secs(30));
    stream_ping_interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);

    loop {
        tokio::select! {
            line = rx.recv() => {
                match line {
                    Some(raw_line) => {
                        // Parse to extract text for stream_text messages.
                        // Format: {"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"..."}}}
                        if let Ok(val) = serde_json::from_str::<serde_json::Value>(&raw_line) {
                            let msg_type = val.get("type").and_then(|v| v.as_str()).unwrap_or("");

                            // Handle streaming deltas (incremental text chunks).
                            if msg_type == "stream_event" {
                                if let Some(text) = val.pointer("/event/delta/text").and_then(|v| v.as_str()) {
                                    let ws_msg = json!({"type": "stream_text", "text": text});
                                    if sender.send(Message::Text(ws_msg.to_string().into())).await.is_err() {
                                        tracing::warn!("WebSocket send failed during streaming");
                                        claude_handle.abort();
                                        return Ok(());
                                    }
                                }
                            }
                        }
                    }
                    None => break, // Channel closed — claude process finished.
                }
            }
            _ = stream_ping_interval.tick() => {
                if sender.send(Message::Ping(vec![].into())).await.is_err() {
                    tracing::warn!("keepalive ping failed during streaming");
                    claude_handle.abort();
                    return Ok(());
                }
            }
        }
    }

    // Wait for the Claude process result (channel closed = process done).
    let stream_result = match claude_handle.await {
        Ok(Ok(result)) => result,
        Ok(Err(e)) => {
            tracing::error!(error = %e, "claude streaming failed");
            send_error(sender, &format!("claude error: {e}")).await?;
            return Ok(());
        }
        Err(e) => {
            tracing::error!(error = %e, "claude task panicked");
            send_error(sender, "internal error").await?;
            return Ok(());
        }
    };

    // 4. Save assistant response to DB.
    if !stream_result.full_text.is_empty() {
        if let Err(e) =
            crate::db::insert_message(pool, conversation_id, "assistant", &stream_result.full_text)
                .await
        {
            tracing::error!(error = %e, "failed to save assistant message");
        }
    }

    // 5. Update conversation session_id.
    if let Some(ref sid) = stream_result.session_id {
        if let Err(e) = crate::db::update_session_id(pool, conversation_id, sid).await {
            tracing::error!(error = %e, "failed to update session_id");
        }
    }

    // 6. Publish assistant message to NATS (best-effort).
    if let Some(nats) = nats {
        let conv_id_str = conversation_id.to_string();
        if let Err(e) = nats
            .publish_chat_message(
                &claims.user_id,
                &conv_id_str,
                "assistant",
                &stream_result.full_text,
            )
            .await
        {
            tracing::warn!(error = %e, "failed to publish assistant message to NATS");
        }
    }

    // 7. Send message_complete.
    sender
        .send(Message::Text(
            json!({
                "type": "message_complete",
                "conversation_id": conversation_id,
                "session_id": stream_result.session_id,
            })
            .to_string().into(),
        ))
        .await?;

    // 8. Broadcast to other windows so they can refresh.
    let _ = broadcast_tx.send(BroadcastEvent {
        source: connection_id,
        payload: json!({
            "type": "conversation_updated",
            "conversation_id": conversation_id,
        })
        .to_string(),
    });

    Ok(())
}

async fn handle_delete_conversation(
    sender: &mut WsSender,
    pool: &PgPool,
    claims: &UserClaims,
    id_str: &str,
    broadcast_tx: &broadcast::Sender<BroadcastEvent>,
    connection_id: Uuid,
) -> HandlerResult {
    let id = match Uuid::parse_str(id_str) {
        Ok(id) => id,
        Err(_) => {
            send_error(sender, "invalid conversation id").await?;
            return Ok(());
        }
    };

    match crate::db::delete_conversation(pool, id, &claims.user_id).await {
        Ok(true) => {
            sender
                .send(Message::Text(
                    json!({"type": "conversation_deleted", "id": id})
                        .to_string().into(),
                ))
                .await?;

            let _ = broadcast_tx.send(BroadcastEvent {
                source: connection_id,
                payload: json!({
                    "type": "conversations_changed",
                })
                .to_string(),
            });
        }
        Ok(false) => {
            send_error(sender, "conversation not found").await?;
        }
        Err(e) => {
            tracing::error!(error = %e, "failed to delete conversation");
            send_error(sender, "failed to delete conversation").await?;
        }
    }
    Ok(())
}
