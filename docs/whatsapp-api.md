# WhatsApp Messaging Service API

## Overview

The WhatsApp messaging service provides a cluster-internal gateway for sending and receiving WhatsApp messages. Each user links their own WhatsApp account via the homepage, and cluster services can send messages through linked accounts.

## Authentication

All endpoints require a valid Keycloak JWT bearer token.

- **Keycloak Realm**: `homekube`
- **Audience**: `whatsapp`
- **Header**: `Authorization: Bearer <token>`

### User Tokens

Users authenticate through the homepage Keycloak login. Their `preferred_username` is used as the user ID for session management.

### Service Account Tokens

Cluster services obtain tokens via Keycloak client credentials grant:

```bash
curl -X POST "http://keycloak.keycloak.svc.cluster.local/realms/homekube/protocol/openid-connect/token" \
  -d "grant_type=client_credentials" \
  -d "client_id=whatsapp" \
  -d "client_secret=<secret>"
```

## Base URL

- **Cluster-internal**: `http://whatsapp/`
- **Via homepage proxy**: `https://homepage/api/whatsapp/`

---

## REST API

### POST /api/register

Link a WhatsApp account via pairing code.

**Auth**: User JWT

**Request**:
```json
{
  "phoneNumber": "61412345678"
}
```

**Response** (200):
```json
{
  "pairingCode": "A1B2-C3D4",
  "status": "pairing"
}
```

**Errors**:
| Status | Body | Cause |
|--------|------|-------|
| 400 | `{ "error": "phoneNumber is required" }` | Missing phone number |
| 400 | `{ "error": "Invalid phone number" }` | Phone number too short |
| 500 | `{ "error": "..." }` | Internal error |

---

### GET /api/status

Get current WhatsApp session status.

**Auth**: User JWT

**Response** (200):
```json
{
  "status": "connected",
  "phoneNumber": "61412345678",
  "whatsappJid": "61412345678@s.whatsapp.net",
  "errorMessage": null,
  "pairedAt": "2025-01-15T10:30:00.000Z",
  "lastConnectedAt": "2025-01-15T10:30:00.000Z"
}
```

**Status values**: `unregistered` (no session row exists), `pairing`, `connected`, `disconnected`

---

### POST /api/disconnect

Disconnect the current WhatsApp session.

**Auth**: User JWT

**Response** (200):
```json
{
  "status": "disconnected"
}
```

---

### POST /api/send

Send a WhatsApp message. Can be used by both users (sending from their own account) and services (sending from a specified user's account).

**Auth**: User or Service JWT

**Request**:
```json
{
  "userId": "target-username",
  "recipientPhone": "61412345678",
  "message": "Hello from the cluster!"
}
```

- `userId` (optional): Which user's WhatsApp to send from. If omitted, uses the authenticated user's session.
- `recipientPhone` (required): Recipient's phone number with country code.
- `message` (required): Message text to send.

**Response** (200):
```json
{
  "messageId": "BAE5A1B2C3D4E5F6",
  "status": "sent"
}
```

**Errors**:
| Status | Body | Cause |
|--------|------|-------|
| 400 | `{ "error": "recipientPhone and message are required" }` | Missing fields |
| 500 | `{ "error": "No active session for user ..." }` | User not connected |

---

### GET /api/messages

Retrieve message history.

**Auth**: User JWT

**Query Parameters**:
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `remotePhone` | string | — | Filter by remote phone number |
| `limit` | number | 50 | Max messages to return (max 200) |
| `offset` | number | 0 | Pagination offset |

**Response** (200):
```json
{
  "messages": [
    {
      "id": 1,
      "direction": "outbound",
      "remoteJid": "61412345678@s.whatsapp.net",
      "messageText": "Hello!",
      "messageId": "BAE5A1B2C3D4E5F6",
      "status": "sent",
      "sourceService": null,
      "createdAt": "2025-01-15T10:35:00.000Z"
    },
    {
      "id": 2,
      "direction": "inbound",
      "remoteJid": "61412345678@s.whatsapp.net",
      "messageText": "Hi there!",
      "messageId": "BAE5F6E5D4C3B2A1",
      "status": "received",
      "sourceService": null,
      "createdAt": "2025-01-15T10:36:00.000Z"
    }
  ]
}
```

---

## WebSocket API

### Endpoint

- **Direct**: `ws://whatsapp/ws/conversation`
- **Via homepage**: `wss://homepage/api/whatsapp/conversation`

### Protocol

#### 1. Authentication

First message must authenticate the connection:

```json
→ { "type": "auth", "token": "Bearer eyJhbGciOiJS..." }
← { "type": "auth_ok", "username": "johndoe" }
```

Authentication must complete within 10 seconds or the connection is closed.

#### 2. Start Conversation

Bind the WebSocket to a specific user's WhatsApp session and remote contact:

```json
→ { "type": "start_conversation", "userId": "target-user", "remotePhone": "61412345678" }
← { "type": "conversation_started", "remoteJid": "61412345678@s.whatsapp.net" }
← { "type": "history", "messages": [
     { "direction": "outbound", "text": "Previous message", "messageId": "...", "timestamp": "..." }
   ]}
```

- `userId` (optional): Which user's WhatsApp session to use. Defaults to authenticated user.
- `remotePhone` (required): The phone number to converse with.

#### 3. Send Messages

```json
→ { "type": "send_message", "text": "Hello!" }
← { "type": "message_sent", "messageId": "BAE5...", "timestamp": "2025-01-15T10:35:00.000Z" }
```

#### 4. Receive Messages

Incoming messages from the remote contact are pushed automatically:

```json
← { "type": "incoming_message", "text": "Reply text", "remoteJid": "61412345678@s.whatsapp.net", "messageId": "...", "timestamp": "..." }
```

#### 5. Errors

```json
← { "type": "error", "message": "No active session for user ..." }
```

### WebSocket Message Types

| Direction | Type | Fields |
|-----------|------|--------|
| → Client | `auth` | `token` |
| ← Server | `auth_ok` | `username` |
| → Client | `start_conversation` | `userId?`, `remotePhone` |
| ← Server | `conversation_started` | `remoteJid` |
| ← Server | `history` | `messages[]` |
| → Client | `send_message` | `text` |
| ← Server | `message_sent` | `messageId`, `timestamp` |
| ← Server | `incoming_message` | `text`, `remoteJid`, `messageId`, `timestamp` |
| ← Server | `error` | `message` |

---

## Error Codes

| HTTP Status | Meaning |
|-------------|---------|
| 400 | Bad request (missing/invalid parameters) |
| 401 | Unauthorized (missing or invalid JWT) |
| 500 | Internal server error |

| WebSocket Close Code | Meaning |
|---------------------|---------|
| 4001 | Authentication timeout |
| 4002 | First message was not auth |
| 4003 | Authentication failed |

---

## Service-to-Service Usage Guide

### 1. Create a Keycloak Client

Create a client `whatsapp` in the `homekube` realm with:
- Client authentication: ON
- Service accounts roles: ON
- Valid redirect URIs: (not needed for service accounts)

### 2. Obtain a Token

```bash
TOKEN=$(curl -s -X POST \
  "http://keycloak.keycloak.svc.cluster.local/realms/homekube/protocol/openid-connect/token" \
  -d "grant_type=client_credentials" \
  -d "client_id=your-service" \
  -d "client_secret=your-secret" \
  | jq -r '.access_token')
```

### 3. Send a Message (REST)

```bash
curl -X POST http://whatsapp/api/send \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "target-user",
    "recipientPhone": "61412345678",
    "message": "Alert: CPU usage above 90%"
  }'
```

### 4. Hold a Conversation (WebSocket)

```javascript
const ws = new WebSocket('ws://whatsapp/ws/conversation');

ws.on('open', () => {
  ws.send(JSON.stringify({ type: 'auth', token: `Bearer ${TOKEN}` }));
});

ws.on('message', (data) => {
  const msg = JSON.parse(data);

  if (msg.type === 'auth_ok') {
    ws.send(JSON.stringify({
      type: 'start_conversation',
      userId: 'target-user',
      remotePhone: '61412345678'
    }));
  }

  if (msg.type === 'conversation_started') {
    ws.send(JSON.stringify({ type: 'send_message', text: 'Hello!' }));
  }

  if (msg.type === 'incoming_message') {
    console.log(`Received: ${msg.text}`);
    // Process and reply...
  }
});
```

---

## Deployment

- **Service name**: `whatsapp`
- **Port**: `80` (ClusterIP) → `3000` (container)
- **Database**: CloudNative PG cluster `whatsapp-db`
- **Image**: `localhost:5000/whatsapp:latest`

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | — | PostgreSQL connection string |
| `KEYCLOAK_URL` | `http://keycloak.keycloak.svc.cluster.local` | Keycloak base URL |
| `KEYCLOAK_REALM` | `homekube` | Keycloak realm |
| `KEYCLOAK_AUDIENCE` | `whatsapp` | Expected JWT audience |
| `PORT` | `3000` | Server listen port |
