# WhatsApp Authorization System (Strategic)

## 1. Problem Statement

Authenticated users can currently bypass ownership by passing a `userId` parameter to `/api/send` and WebSocket `start_conversation`, allowing them to operate on **any** user's WhatsApp session. The WhatsApp service validates Keycloak JWTs (authentication) but performs zero authorization checks (who can do what).

**Implementation Implication:** Every route handler that extracts `userId` from the request body must enforce ownership — the authenticated user can only operate on their own session unless they are an authorized service account.

## 2. Success Metrics

- Zero unauthorized cross-user session access
- All 7 REST endpoints enforce ownership
- WebSocket `start_conversation` enforces ownership
- Service accounts with `whatsapp-service` realm role can still use `userId` parameter
- No regressions to existing functionality (linking, QR, send, messages, disconnect)

**Implementation Implication:** Every endpoint must be tested for both user-owned access and unauthorized cross-user access attempts.

## 3. Architecture Decision

Use Keycloak JWT claims to determine authorization:

| Claim | Purpose |
|-------|---------|
| `preferred_username` / `sub` | User identity (ownership correlation) |
| `realm_access.roles[]` | Check for `whatsapp-service` role to allow cross-user access |

**Decision:** Ownership enforcement at the route handler level, not middleware level. Middleware continues to handle authentication only. Each route decides whether the caller has permission for the specific operation.

**Rationale:** Different endpoints have different authz logic (e.g., `/api/send` allows `userId` for service accounts, but `/api/link` never allows cross-user). Putting authz in route handlers keeps the logic co-located with the business logic.

**Implementation Implication:** Add a shared utility function `resolveUserId(tokenPayload, requestedUserId)` that returns the effective userId or throws 403. Each route handler calls this where needed.

## 4. What We're Building (MVP)

1. Extract `realm_access.roles` from JWT payload in `auth.ts`
2. Add `resolveUserId()` authorization utility
3. Enforce ownership on all REST endpoints
4. Enforce ownership on WebSocket `start_conversation`
5. Return 403 Forbidden (not 401) for authorization failures
6. Update Keycloak SETUP.md with service account configuration

**Implementation Implication:** Changes touch `auth.ts`, `routes/rest.ts`, `routes/ws.ts`, and `SETUP.md`. No database schema changes needed.

## 5. What We're NOT Building

- No admin roles or admin UI
- No per-resource permissions (e.g., per-contact access control)
- No rate limiting
- No audit logging (beyond existing console.log)
- No Keycloak realm role auto-provisioning

## REFERENCES

### Implementation Details Location
| Content Type | Location |
|--------------|----------|
| Anti-patterns | [Implementation Spec, Section 5](whatsapp-authz-spec.md#anti-patterns-do-not) |
| Test Cases | [Implementation Spec, Section 6](whatsapp-authz-spec.md#test-case-specifications) |
| Error Handling | [Implementation Spec, Section 7](whatsapp-authz-spec.md#error-handling-matrix) |

### Existing Code References
| Topic | Location |
|-------|----------|
| Current auth middleware | [whatsapp/src/auth.ts](../whatsapp/src/auth.ts) |
| REST route handlers | [whatsapp/src/routes/rest.ts](../whatsapp/src/routes/rest.ts) |
| WebSocket handler | [whatsapp/src/routes/ws.ts](../whatsapp/src/routes/ws.ts) |
| Keycloak setup | [keycloak/SETUP.md](../keycloak/SETUP.md) |
| WhatsApp API docs | [docs/whatsapp-api.md](whatsapp-api.md) |

*This document provides strategic overview. See [Implementation Spec](whatsapp-authz-spec.md) for technical details.*
