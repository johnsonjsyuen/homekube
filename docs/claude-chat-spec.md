# Claude Chat Feature — Implementation Spec

## Overview

Add a conversational chat tab to the homepage app that communicates with Claude Code CLI
via WebSocket streaming. NATS JetStream provides event persistence, PostgreSQL stores
long-term conversation/message history. Each conversation maps to a Claude Code CLI
session with `--resume` support for continuity.

## Architecture

```
[Homepage App]                [claude-code-api (Rust/Axum)]
  ChatTab.svelte  ──WebSocket──►  /ws/chat handler
                                    │
                                    ├──► PostgreSQL (conversations, messages)
                                    ├──► NATS JetStream (chat.{user_id}.{conv_id})
                                    └──► claude CLI --output-format stream-json
                                              --dangerously-skip-permissions
                                              [--resume {session_id}]
```

## Backend: claude-code-api Changes

### New Dependencies (Cargo.toml)

```toml
sqlx = { version = "0.8", features = ["runtime-tokio", "tls-rustls", "postgres", "uuid", "chrono"] }
async-nats = "0.38"
uuid = { version = "1", features = ["v4", "serde"] }
chrono = { version = "0.4", features = ["serde"] }
futures = "0.3"
jsonwebtoken = "9"
tokio-stream = "0.1"
```

### Database Schema (PostgreSQL via CNPG)

```sql
-- V1__init.sql
CREATE TABLE conversations (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     TEXT NOT NULL,           -- Keycloak JWT sub
    title       TEXT NOT NULL DEFAULT 'New conversation',
    session_id  TEXT,                     -- Claude CLI resume token
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_conversations_user ON conversations(user_id, updated_at DESC);

CREATE TABLE messages (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    role            TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content         TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_messages_conversation ON messages(conversation_id, created_at);
```

### New Modules

#### `db.rs` — Database layer
- `create_pool(database_url) -> PgPool`
- `create_conversation(pool, user_id, title) -> Conversation`
- `list_conversations(pool, user_id) -> Vec<Conversation>`
- `get_conversation(pool, id, user_id) -> Option<Conversation>`
- `update_session_id(pool, id, session_id)`
- `delete_conversation(pool, id, user_id)`
- `insert_message(pool, conversation_id, role, content) -> Message`
- `get_messages(pool, conversation_id) -> Vec<Message>`
- `update_conversation_title(pool, id, title)`

#### `nats_client.rs` — NATS JetStream
- `connect(nats_url) -> NatsClient`
- `publish_message(client, user_id, conversation_id, role, content)` — publishes to `chat.{user_id}.{conversation_id}`
- Stream: `CHAT_MESSAGES`, subjects: `chat.>`, retention: limits (not work-queue, since we want history), max-age: 720h (30 days)

#### `auth.rs` — JWT validation
- Validate Keycloak JWT bearer token
- Extract `sub` (user_id) and `preferred_username` from claims
- Keycloak JWKS endpoint: `https://auth.johnsonyuen.com/realms/homekube/protocol/openid-connect/certs`
- Validation: verify signature, check expiry. Issuer/audience = `any` (matching existing services)

#### `chat.rs` — WebSocket handler

**Route:** `GET /ws/chat` → WebSocket upgrade

**Protocol:**

| Direction | Type | Payload |
|-----------|------|---------|
| Client→Server | `auth` | `{type: "auth", token: "Bearer ..."}` |
| Server→Client | `auth_ok` | `{type: "auth_ok", user_id: "...", username: "..."}` |
| Server→Client | `auth_error` | `{type: "auth_error", message: "..."}` |
| Client→Server | `list_conversations` | `{type: "list_conversations"}` |
| Server→Client | `conversations` | `{type: "conversations", data: [{id, title, updated_at}]}` |
| Client→Server | `create_conversation` | `{type: "create_conversation", title?: "..."}` |
| Server→Client | `conversation_created` | `{type: "conversation_created", id: "...", title: "..."}` |
| Client→Server | `load_conversation` | `{type: "load_conversation", id: "..."}` |
| Server→Client | `conversation_loaded` | `{type: "conversation_loaded", id: "...", messages: [...]}` |
| Client→Server | `send_message` | `{type: "send_message", conversation_id: "...", content: "..."}` |
| Server→Client | `stream_text` | `{type: "stream_text", text: "..."}` (one per stdout line) |
| Server→Client | `message_complete` | `{type: "message_complete", conversation_id: "...", session_id: "..."}` |
| Server→Client | `error` | `{type: "error", message: "..."}` |
| Client→Server | `delete_conversation` | `{type: "delete_conversation", id: "..."}` |
| Server→Client | `conversation_deleted` | `{type: "conversation_deleted", id: "..."}` |

**Auth flow:** First message must be `auth` within 10 seconds or connection closes.

**Message send flow:**
1. Save user message to PostgreSQL
2. Publish user message to NATS
3. Build CLI args: `claude -p - --output-format stream-json --dangerously-skip-permissions [--resume {session_id}]`
4. Pipe user message content to stdin
5. Read stdout line by line, parse each JSON line
6. For lines with text content (`assistant` type), send `stream_text` over WebSocket
7. Extract `session_id` from `init` or `result` message
8. On completion: save full assistant response to PostgreSQL, update conversation session_id, publish to NATS
9. Send `message_complete` with session_id

#### `claude.rs` — Add streaming function

```rust
pub async fn invoke_claude_streaming(
    prompt: &str,
    session_id: Option<&str>,
    line_callback: impl FnMut(String) + Send,
) -> Result<StreamResult, ClaudeError>
```

- Args: `["--output-format", "stream-json", "--dangerously-skip-permissions", "-p", "-"]`
- If session_id provided: add `["--resume", session_id]`
- Read stdout with `BufReader::lines()`, call `line_callback` for each line
- Return `StreamResult { session_id: Option<String>, full_text: String }`

### Updated `main.rs`

- Add `PgPool`, `NatsClient` to `AppState`
- Add route: `.route("/ws/chat", get(chat::ws_handler))`
- Init DB pool from `DATABASE_URL` env var
- Connect NATS from `NATS_URL` env var
- Run sqlx migrations on startup

### Updated Dockerfile

```dockerfile
FROM rust:1.85-slim AS builder
RUN apt-get update && apt-get install -y pkg-config libssl-dev && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY Cargo.toml Cargo.lock ./
RUN mkdir src && echo 'fn main(){}' > src/main.rs && cargo build --release && rm -rf src
COPY src/ src/
COPY migrations/ migrations/
RUN touch src/main.rs && cargo build --release

FROM node:22-slim
RUN npm install -g @anthropic-ai/claude-code
COPY --from=builder /app/target/release/claude-code-api /usr/local/bin/
COPY migrations/ /app/migrations/
EXPOSE 3000
ENV RUST_LOG=info
CMD ["claude-code-api"]
```

### K8s Changes

**CNPG Database** (`claude-code-api/k8s/database.yaml`):
```yaml
apiVersion: postgresql.cnpg.io/v1
kind: Cluster
metadata:
  name: claude-chat-db
  namespace: default
spec:
  instances: 1
  storage:
    size: 2Gi
  bootstrap:
    initdb:
      database: claude_chat
      owner: claude_chat
```

**Updated deploy.yaml** env vars:
```yaml
- name: DATABASE_URL
  value: "postgres://$(DB_USER):$(DB_PASS)@claude-chat-db-rw:5432/claude_chat"
- name: DB_USER
  valueFrom:
    secretKeyRef:
      name: claude-chat-db-app
      key: username
- name: DB_PASS
  valueFrom:
    secretKeyRef:
      name: claude-chat-db-app
      key: password
- name: NATS_URL
  value: "nats://nats.default.svc.cluster.local:4222"
```

## Frontend: Homepage App Changes

### `config.ts`
```ts
claudeChat: {
    wsUrl: import.meta.env.VITE_CLAUDE_CHAT_WS_URL || 'wss://claude.johnsonyuen.com/ws/chat',
}
```

### `ChatTab.svelte`

**Layout:**
- Left sidebar: conversation list with "New Chat" button
- Main area: message list (scrollable) + input box at bottom
- Messages styled as chat bubbles: user (right-aligned, blue) / assistant (left-aligned, dark)
- Assistant messages render as markdown (or just preformatted text for simplicity)
- Streaming indicator while receiving response
- Connection status badge

**State:**
- `conversations: []` — list from server
- `activeConversation: null` — currently open
- `messages: []` — messages in active conversation
- `inputText: ""` — current input
- `streaming: boolean` — whether response is being streamed
- `streamBuffer: string` — accumulated stream text
- WebSocket connection (same auth pattern as STT/LiveTTS)

**Behavior:**
- On mount + auth: connect WebSocket, list conversations
- New Chat: create conversation, open it
- Select conversation: load messages
- Send message: append to UI immediately, send over WS, show streaming indicator
- Stream lines: append to assistant message bubble in real-time
- On complete: finalize assistant message

### `+page.svelte`
- Add `chat` to tab list and tabLabels
- Import and render `ChatTab`

## NATS Stream Init

Add to `nats/k8s/init-streams.yaml`:
```bash
nats -s nats://nats:4222 stream add CHAT_MESSAGES --subjects="chat.>" --retention=limits --storage=file --max-age=720h --replicas=1 --discard=old --defaults
```

No consumer needed — NATS is used for event persistence only (no pull consumers for chat).

## Anti-Patterns

| Don't | Do Instead | Why |
|-------|------------|-----|
| Store session_id client-side | Store in PostgreSQL per conversation | Security + single source of truth |
| Send raw JWT over WebSocket URL params | Send as first WebSocket message | Avoid token in access logs |
| Buffer entire response before sending | Stream line-by-line as received | User sees progress immediately |
| Create new CLI process per WebSocket connection | Create per message send | Conversations are stateless between messages |
| Use work-queue retention for CHAT_MESSAGES | Use limits retention | We want to keep messages, not consume-and-delete |
| Parse stream-json deeply | Forward text lines, only parse for session_id | Keep it simple, avoid breakage on CLI updates |
