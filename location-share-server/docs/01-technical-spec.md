# Location Share Server - Technical Specification (Implementation)

## 1. System Overview

Server-side implementation of the `LocationApi` interface defined in [location-share-app/docs/02-technical-spec.md](../../location-share-app/docs/02-technical-spec.md#api-interface). Quarkus 3.20.5 + Kotlin + jOOQ + PostgreSQL. Keycloak OIDC bearer token auth. Deployed to Kubernetes via CNPG PostgreSQL operator.

## 2. REST API Endpoints

| Client Method | HTTP | Path | Request Body | Response | Status |
|--------------|------|------|-------------|----------|--------|
| `getFamily()` | GET | `/api/family` | - | `FamilyGroup` | 200 |
| `getFamilyLocations()` | GET | `/api/family/locations` | - | `MemberLocation[]` | 200 |
| `reportLocations(reports)` | POST | `/api/locations` | `LocationReport[]` | - | 204 |
| `getLocationHistory(query)` | GET | `/api/locations/history?memberId=&date=` | - | `HistoryPoint[]` | 200 |
| `getPlaces()` | GET | `/api/places` | - | `Place[]` | 200 |
| `createPlace(place)` | POST | `/api/places` | `PlaceCreate` | `Place` | 201 |
| `updatePlace(id, update)` | PUT | `/api/places/{id}` | `PlaceUpdate` | `Place` | 200 |
| `deletePlace(id)` | DELETE | `/api/places/{id}` | - | - | 204 |

All endpoints require `@Authenticated` (Keycloak bearer token).

### 2.1 Auth & Identity

| Concern | Implementation |
|---------|---------------|
| Member ID | JWT `sub` claim (Keycloak subject UUID) |
| Display name | JWT `name` claim, fallback `preferred_username` |
| Token validation | Quarkus OIDC bearer-only, `audience=any`, `issuer=any` |
| Principal claim | `sub` (configured via `quarkus.oidc.token.principal-claim`) |

### 2.2 Scoping Rules

| Endpoint | Scoping Rule |
|----------|-------------|
| `getFamilyLocations` | Returns latest location for each member in caller's family group |
| `reportLocations` | `memberId` in request body is **ignored**; uses JWT `sub` |
| `getLocationHistory` | Only returns data if target member is in caller's family group |
| Place CRUD | Scoped to caller's family group |

### 2.3 Auto-Provisioning

On any authenticated API call, if the member doesn't exist in `members` table:

1. Extract `sub` (member ID) and `name` / `preferred_username` (display name) from JWT
2. Get the default family group (first row in `family_groups`)
3. Insert new member with `role='member'`

This means any Keycloak user in the `homekube` realm can join. Access control is via Keycloak account management.

## 3. PostgreSQL Schema

Adapted from client SQLite schema. Key differences:

| SQLite | PostgreSQL |
|--------|-----------|
| `TEXT` timestamps | `TIMESTAMPTZ` |
| `REAL` | `DOUBLE PRECISION` |
| `INTEGER PRIMARY KEY AUTOINCREMENT` | `BIGSERIAL PRIMARY KEY` |
| `source` / `synced` columns | Not needed (server doesn't track client sync state) |
| No family group concept | `family_groups` table + FK in `members` and `places` |

Full DDL in `src/main/resources/db/migration/V1__create_tables.sql`.

## 4. Derived Fields

| Field | Derivation |
|-------|-----------|
| `isOnline` | `true` if member's latest location timestamp is within 5 minutes of `NOW()` |

## 5. Anti-Patterns (DO NOT)

| # | Don't | Do Instead | Why |
|---|-------|------------|-----|
| 1 | Trust `memberId` in `reportLocations` request body | Override with JWT `sub` | Prevents spoofing another user's location |
| 2 | Return locations for members outside caller's family group | Always scope queries by `family_group_id` | Data isolation between families |
| 3 | Store timestamps as TEXT | Use `TIMESTAMPTZ` in PostgreSQL | Proper timezone handling, indexing, range queries |
| 4 | Use `SELECT *` in jOOQ | Explicitly list columns | Schema changes won't break queries |
| 5 | Create N+1 queries for latest-per-member | Use `DISTINCT ON` in single query | Performance with many members/locations |
| 6 | Skip input validation on coordinates | Validate lat [-90,90], lng [-180,180], radius [50,2000] | Garbage data corrupts geofence logic |

## 6. Test Case Specifications

### Unit Tests

| Test ID | Component | Input | Expected Output | Edge Cases |
|---------|-----------|-------|-----------------|------------|
| TC-001 | `reportLocations` | 5 valid reports | 5 rows in `locations` table | Empty array, max batch (100) |
| TC-002 | `getFamilyLocations` | 3 members with multiple locations each | 1 latest location per member | Member with 0 locations, single member |
| TC-003 | `getLocationHistory` | memberId + date with 50 points | 50 points ordered by timestamp ASC | Date with 0 points, member not in family |
| TC-004 | `createPlace` | Valid PlaceCreate | Place with generated UUID, createdBy = caller | Invalid radius (<50 or >2000) |
| TC-005 | `updatePlace` | Partial PlaceUpdate (name only) | Only name changed, other fields unchanged | Place not found, place in different family |
| TC-006 | Auto-provisioning | New user's first API call | Member created in default family group | User already exists (no-op) |
| TC-007 | `isOnline` derivation | Location timestamp 3 min ago vs 10 min ago | true vs false | Exactly 5 minutes (boundary) |

### Integration Tests

| Test ID | Flow | Setup | Verification | Teardown |
|---------|------|-------|--------------|----------|
| IT-001 | Report + fetch locations | Auth as user A | `reportLocations` then `getFamilyLocations` returns user A's location | Delete test data |
| IT-002 | Family scoping | Two users in same family | User A sees User B's location | Delete test data |
| IT-003 | Place CRUD cycle | Auth as user | Create, read, update, delete place | Delete test data |

## 7. Error Handling Matrix

| Error Type | Detection | Response | Status | Logging |
|------------|-----------|----------|--------|---------|
| Invalid bearer token | Quarkus OIDC | `Unauthorized` | 401 | WARN |
| Member not in any family | DB lookup returns null | Auto-provision member | - | INFO |
| Target member not in caller's family | DB join returns empty | `Not Found` | 404 | WARN |
| Place not found | DB lookup returns null | `Not Found` | 404 | WARN |
| Invalid coordinates | Validation check | `Bad Request` with message | 400 | WARN |
| Invalid date format | Parse exception | `Bad Request` with message | 400 | WARN |
| Database error | SQL exception | `Internal Server Error` | 500 | ERROR |

## 8. References

| Topic | Location |
|-------|----------|
| Client API interface | [location-share-app/docs/02-technical-spec.md, Section 3](../../location-share-app/docs/02-technical-spec.md#api-interface) |
| Client TypeScript types | [location-share-app/docs/03-schema-reference.md, Section 2](../../location-share-app/docs/03-schema-reference.md#typescript-types) |
| Value constraints | [location-share-app/docs/03-schema-reference.md, Section 4](../../location-share-app/docs/03-schema-reference.md#constraints) |
| Client sync design | [location-share-app/docs/02-technical-spec.md, Section 6](../../location-share-app/docs/02-technical-spec.md#offline-sync) |
| Quarkus/jOOQ patterns | [workflows-worker/](../../workflows-worker/) |
| k8s deployment patterns | [workflows-worker/k8s/](../../workflows-worker/k8s/) |
