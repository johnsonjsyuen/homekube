# Family Location Sharing App - Strategic Blueprint (Strategic)

## 1. Problem Statement

Help a family group see each other's real-time locations on a map, know when members arrive/leave designated places (geofences), and review location history. Self-hosted, privacy-first alternative to Life360.

**Implementation Implication:** All location data stays on user's own infrastructure. No third-party analytics or data sharing. Frontend must work fully with mocked API for development/demo.

## 2. Success Metrics

| Metric | Target | Timeline |
|--------|--------|----------|
| Single family group functional | 1 group, up to 10 members | MVP |
| Live map with member pins | Real-time position updates on interactive map | MVP |
| Geofence alerts | Visual indicators for arrival/departure at defined places | MVP |
| Location history | Per-member trail viewable on map with time scrubbing | MVP |
| Frontend fully demonstrable | All UI flows work against mocked API | MVP |

**Implementation Implication:** Mock API must return realistic data for all flows. No server implementation required.

## 3. Competitive Advantage

Self-hosted on existing infrastructure (Tauri + Keycloak). No data sold to brokers. User owns all location data. Tauri provides native GPS access on mobile and desktop. Existing Keycloak authentication already deployed.

**Implementation Implication:** Retain existing Keycloak auth integration from `$lib/auth.ts`. Tauri geolocation plugin for native GPS.

## 4. Core Architecture Decision

SvelteKit 5 SPA frontend with Leaflet (free, OpenStreetMap tiles, no API key) for maps. Tauri SQL plugin (`@tauri-apps/plugin-sql`) with SQLite as local persistence layer. REST API mocked in-app via `$lib/api/mock.ts`. Tauri 2 for native device capabilities (GPS). Keep Keycloak auth.

**ADR-001: Map Library**
- Decision: Leaflet with OpenStreetMap tiles
- Alternatives considered: MapLibre GL JS (heavier, WebGL), Google Maps (API key + cost), Mapbox (API key + cost)
- Rationale: Zero cost, no API key, lightweight, well-supported, sufficient for pin/polygon rendering

**ADR-002: API Mocking Strategy**
- Decision: In-app mock module (`$lib/api/mock.ts`) implementing same interface as future real client
- Alternatives considered: MSW (Service Worker mock), separate mock server
- Rationale: Simplest for Tauri context, no network layer needed, swap to real client later via config flag
- Pattern: `$lib/api/client.ts` exports interface, `$lib/api/mock.ts` implements it, `$lib/api/index.ts` selects based on config

**ADR-003: State Management**
- Decision: Svelte 5 runes (`$state`, `$derived`) as reactive view layer, backed by SQLite as source of truth
- Pattern: SQLite DB -> reactive stores (runes) -> UI. All writes go to DB first, stores react to DB changes.
- Alternatives considered: Runes-only (no persistence), IndexedDB (no Tauri plugin, worse query support)
- Rationale: SQLite gives offline persistence, full SQL queries for history, and Tauri plugin is maintained first-party

**ADR-004: Local Persistence & Offline Sync**
- Decision: `@tauri-apps/plugin-sql` with SQLite. All locations (own + received from family) persisted locally.
- Offline behavior: Device continues recording own GPS positions to SQLite with timestamps. On reconnect, all queued positions are batch-sent to server with original timestamps.
- Received locations: All family member locations received from server are also stored in SQLite, enabling offline browsing of previously received history.
- Sync state: Each outbound location row has a `synced` boolean. Sync process queries `WHERE synced = false`, sends batch, marks synced on success.
- Rationale: SQLite is embedded, zero-config, handles concurrent reads well, and Tauri's plugin provides migrations support.

**Implementation Implication:** Add `leaflet` and `@tauri-apps/plugin-sql` as dependencies. Register SQL plugin in Tauri. Create DB schema with migrations. Create `$lib/db/` module for all DB operations. Reactive stores in `$lib/stores/` read from DB and expose runes. API layer writes to DB; sync service reads from DB and pushes to server.

## 5. Tech Stack Rationale

| Technology | Rationale |
|------------|-----------|
| SvelteKit 5 | Already working in project, Svelte 5 runes for reactive state |
| Tauri 2 | Already configured, provides native GPS, cross-platform (desktop + Android) |
| Tailwind 4 | Already configured via `@tailwindcss/vite` |
| Leaflet | Free OSM maps, no API key, lightweight (~40KB), great plugin ecosystem |
| @tauri-apps/plugin-sql | First-party Tauri SQLite plugin. Local persistence, migrations, offline storage |
| Keycloak | Already deployed at `auth.johnsonyuen.com`, auth flow working |
| TypeScript | Already configured, type safety for API interfaces |

## 6. MVP Features

| Priority | Feature | Description |
|----------|---------|-------------|
| P0 | Live Map | Interactive map showing all family members as pins with name/avatar, auto-centers on family bounds |
| P0 | Member List | Sidebar/bottom sheet listing members with name, last location, last-seen time, battery level |
| P1 | Places (Geofences) | Define named circular zones (Home, School, Work). Show on map. Indicate which members are currently inside |
| P1 | Location History | Per-member path trail on map. Date picker to select day. Timeline scrubber |
| P1 | Offline Persistence | All locations (own + family) stored in local SQLite. Own positions queued when offline, batch synced with timestamps on reconnect. Offline browsing of previously received locations |

## 7. Explicit Exclusions (NOT Building)

| Excluded Feature | Rationale |
|------------------|-----------|
| Server/backend implementation | Mock only per requirement. API interface designed for future real implementation |
| Push notifications | Requires server-side event system. Out of scope for frontend-only MVP |
| Crash/driving detection | Requires accelerometer + ML. Life360 premium feature, not MVP |
| Chat/messaging | Different product domain. Use existing messaging apps |
| Multi-family support | Single family group sufficient for personal use. Simplifies auth model |
| Route optimization | Navigation is a separate product (Google Maps, Waze) |
| Battery optimization | Tauri/OS-level concern, not frontend |

## References

### Implementation Details Location

| Content Type | Location |
|--------------|----------|
| API Interface Spec | [Technical Spec, Section 3](./02-technical-spec.md#api-interface) |
| Component Architecture | [Technical Spec, Section 4](./02-technical-spec.md#component-architecture) |
| DB Schema & Migrations | [Technical Spec, Section 5](./02-technical-spec.md#database-schema) |
| Offline Sync Design | [Technical Spec, Section 6](./02-technical-spec.md#offline-sync) |
| Anti-patterns | [Technical Spec, Section 9](./02-technical-spec.md#anti-patterns) |
| Test Cases | [Technical Spec, Section 10](./02-technical-spec.md#test-case-specifications) |
| Error Handling | [Technical Spec, Section 11](./02-technical-spec.md#error-handling-matrix) |
| SQLite Table Schemas | [Schema Reference, Section 1](./03-schema-reference.md#sqlite-tables) |
| TypeScript Types | [Schema Reference, Section 2](./03-schema-reference.md#typescript-types) |
| Type Mapping Rules | [Schema Reference, Section 3](./03-schema-reference.md#type-mapping) |
| Value Constraints | [Schema Reference, Section 4](./03-schema-reference.md#constraints) |

*This document provides strategic overview. Technical documents provide implementation specifications.*
