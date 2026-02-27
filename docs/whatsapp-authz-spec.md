# WhatsApp Authorization Implementation Spec (Implementation)

## 1. Token Payload Extension

Extend `TokenPayload` in `auth.ts` to include Keycloak realm roles:

```typescript
export interface TokenPayload {
    sub: string;
    preferred_username: string;
    exp: number;
    iat: number;
    aud?: string | string[];
    azp?: string;
    realm_access?: {
        roles: string[];
    };
}
```

No changes to `validateToken()` or `authMiddleware()` — the JWT already contains `realm_access`, we just weren't typing it.

## 2. Authorization Utility

Add to `auth.ts`:

```typescript
export function isServiceAccount(payload: TokenPayload): boolean {
    const roles = payload.realm_access?.roles ?? [];
    return roles.includes('whatsapp-service');
}

export function resolveUserId(payload: TokenPayload, requestedUserId?: string): string {
    const callerUserId = payload.preferred_username || payload.sub;

    if (!requestedUserId || requestedUserId === callerUserId) {
        return callerUserId;
    }

    if (isServiceAccount(payload)) {
        return requestedUserId;
    }

    throw new AuthorizationError(
        `User ${callerUserId} is not authorized to act on behalf of ${requestedUserId}`
    );
}

export class AuthorizationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'AuthorizationError';
    }
}
```

### Behavior Matrix

| Caller Type | `userId` param | Result |
|-------------|---------------|--------|
| Regular user | absent/omitted | Uses caller's own `preferred_username` or `sub` |
| Regular user | same as caller | Uses caller's own ID (no-op) |
| Regular user | different user | **403 Forbidden** |
| Service account (has `whatsapp-service` role) | absent | Uses service account's own identity |
| Service account (has `whatsapp-service` role) | any user | Uses requested `userId` (cross-user allowed) |

## 3. REST Endpoint Changes

### Endpoints that need NO changes (already ownership-only)

These endpoints already derive `userId` solely from the token with no `userId` body parameter:

| Endpoint | Current behavior | Change needed |
|----------|-----------------|---------------|
| `POST /api/link` | Uses `preferred_username` from token | None |
| `GET /api/qr` | Uses `preferred_username` from token | None |
| `POST /api/register` | Uses `preferred_username` from token | None |
| `GET /api/status` | Uses `preferred_username` from token | None |
| `POST /api/disconnect` | Uses `preferred_username` from token | None |
| `GET /api/messages` | Uses `preferred_username` from token | None |

### Endpoints that need authz enforcement

#### `POST /api/send`

**Current (insecure):**
```typescript
const senderId = userId || user.preferred_username || user.sub;
```

**New (with authz):**
```typescript
import { resolveUserId, AuthorizationError } from '../auth.js';

// In the handler:
try {
    const senderId = resolveUserId(user, userId);
} catch (err) {
    if (err instanceof AuthorizationError) {
        res.status(403).json({ error: err.message });
        return;
    }
    throw err;
}
```

## 4. WebSocket Endpoint Changes

### `start_conversation` message in `routes/ws.ts`

**Current (insecure):**
```typescript
const targetUserId = data.userId || username;
```

**New (with authz):**
```typescript
import { resolveUserId, AuthorizationError } from '../auth.js';

// In the start_conversation handler:
try {
    const targetUserId = resolveUserId(userPayload, data.userId);
} catch (err) {
    if (err instanceof AuthorizationError) {
        ws.send(JSON.stringify({ type: 'error', message: err.message }));
        return;
    }
}
```

This requires passing the full `TokenPayload` through WebSocket auth instead of just the username string.

### WebSocket Auth Flow Change

Currently `ws.ts` stores only `username` after auth. Change to store the full `TokenPayload`:

```
Before: auth → extract username → store username string
After:  auth → extract payload  → store TokenPayload object
```

## 5. Anti-Patterns (DO NOT)

| # | Don't | Do Instead | Why |
|---|-------|-----------|-----|
| 1 | Put authz logic in `authMiddleware` | Put authz in each route handler via `resolveUserId()` | Different endpoints have different authz requirements |
| 2 | Check roles via string comparison on `azp` | Check `realm_access.roles` array | `azp` is the client ID, not a role indicator |
| 3 | Return 401 for authz failures | Return 403 Forbidden | 401 = "who are you?", 403 = "you can't do that" |
| 4 | Silently ignore invalid `userId` param | Explicitly throw 403 | Silent fallback to caller's ID hides bugs and security issues |
| 5 | Trust `userId` from request body without validation | Always validate via `resolveUserId()` | Any user-supplied `userId` is untrusted input |
| 6 | Create a separate authz middleware that blocks all cross-user | Keep authz per-route with `resolveUserId()` | Only `/api/send` and WebSocket need cross-user; others are already ownership-only |
| 7 | Hardcode role name strings throughout route files | Export `WHATSAPP_SERVICE_ROLE` constant from `auth.ts` | Single source of truth for role name |

## 6. Test Case Specifications

### Unit Tests

| Test ID | Component | Input | Expected Output | Edge Cases |
|---------|-----------|-------|-----------------|------------|
| TC-001 | `resolveUserId` | Regular user, no `userId` param | Returns caller's `preferred_username` | `preferred_username` missing, falls back to `sub` |
| TC-002 | `resolveUserId` | Regular user, `userId` = own username | Returns caller's username (no-op) | Exact string match required |
| TC-003 | `resolveUserId` | Regular user, `userId` = different user | Throws `AuthorizationError` | Empty string `userId` treated as absent |
| TC-004 | `resolveUserId` | Service account with `whatsapp-service` role, `userId` = other user | Returns requested `userId` | Service account with empty roles array → denied |
| TC-005 | `resolveUserId` | Service account without `whatsapp-service` role, `userId` = other user | Throws `AuthorizationError` | Has other roles but not `whatsapp-service` |
| TC-006 | `isServiceAccount` | Payload with `realm_access.roles: ['whatsapp-service']` | Returns `true` | `realm_access` undefined → `false` |
| TC-007 | `isServiceAccount` | Payload with `realm_access.roles: ['other-role']` | Returns `false` | Empty roles array → `false` |

### Integration Tests

| Test ID | Flow | Setup | Verification | Teardown |
|---------|------|-------|--------------|----------|
| IT-001 | User sends own message | Create user token, call `POST /api/send` without `userId` | 200 response, message sent from caller's session | N/A |
| IT-002 | User attempts cross-user send | Create user token, call `POST /api/send` with different `userId` | 403 response with error message | N/A |
| IT-003 | Service account cross-user send | Create service token with `whatsapp-service` role, call `POST /api/send` with `userId` | 200 response, message sent from target user's session | N/A |
| IT-004 | WebSocket user attempts cross-user conversation | Auth via WS, send `start_conversation` with different `userId` | Error message received via WS | Close WS |
| IT-005 | WebSocket service account cross-user conversation | Auth via WS with service token, send `start_conversation` with `userId` | `conversation_started` received | Close WS |

## 7. Error Handling Matrix

### Authorization Errors

| Error Type | Detection | HTTP/WS Response | Fallback | Logging |
|------------|-----------|-----------------|----------|---------|
| Missing Bearer token | No `Authorization` header | 401 `{ "error": "Missing or invalid Authorization header" }` | None | WARN |
| Invalid/expired JWT | `jwt.verify()` fails | 401 `{ "error": "Invalid token" }` | None | ERROR (existing) |
| Cross-user access by regular user | `resolveUserId()` throws `AuthorizationError` | 403 `{ "error": "User X is not authorized to act on behalf of Y" }` | None | WARN |
| WS cross-user access by regular user | `resolveUserId()` throws in WS handler | WS message `{ "type": "error", "message": "User X is not authorized..." }` | None | WARN |

### Error Response Format

**REST 403:**
```json
{
    "error": "User alice is not authorized to act on behalf of bob"
}
```

**WebSocket error:**
```json
{
    "type": "error",
    "message": "User alice is not authorized to act on behalf of bob"
}
```

## 8. File Change Summary

| File | Change Type | Description |
|------|-------------|-------------|
| `whatsapp/src/auth.ts` | Modify | Add `realm_access` to `TokenPayload`, add `isServiceAccount()`, `resolveUserId()`, `AuthorizationError` |
| `whatsapp/src/routes/rest.ts` | Modify | Use `resolveUserId()` in `POST /api/send` handler, catch `AuthorizationError` → 403 |
| `whatsapp/src/routes/ws.ts` | Modify | Store full `TokenPayload` after auth, use `resolveUserId()` in `start_conversation` handler |
| `docs/whatsapp-api.md` | Modify | Add authz documentation: 403 error code, service account role requirement |
| `keycloak/SETUP.md` | Modify | Add section on creating `whatsapp-service` realm role and assigning to service accounts |

## 9. Keycloak Configuration Changes

### Create `whatsapp-service` Realm Role

1. Go to **Realm roles** in left menu
2. Click **Create role**
3. Set **Role name**: `whatsapp-service`
4. Set **Description**: `Allows cross-user WhatsApp session access for service accounts`
5. Click **Save**

### Assign to Service Account

1. Go to **Clients** → select the service client (e.g., `temporal-worker`)
2. Go to **Service account roles** tab
3. Click **Assign role**
4. Select `whatsapp-service`
5. Click **Assign**

The role appears in the JWT as:
```json
{
    "realm_access": {
        "roles": ["whatsapp-service", "default-roles-homekube"]
    }
}
```

## REFERENCES

| Topic | Location |
|-------|----------|
| Strategic blueprint | [whatsapp-authz-blueprint.md](whatsapp-authz-blueprint.md) |
| Current auth code | [whatsapp/src/auth.ts](../whatsapp/src/auth.ts) |
| REST routes | [whatsapp/src/routes/rest.ts](../whatsapp/src/routes/rest.ts) |
| WebSocket routes | [whatsapp/src/routes/ws.ts](../whatsapp/src/routes/ws.ts) |
| WhatsApp API docs | [whatsapp-api.md](whatsapp-api.md) |
| Keycloak setup | [keycloak/SETUP.md](../keycloak/SETUP.md) |
