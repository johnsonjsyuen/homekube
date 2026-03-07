# Family Location Sharing App - Technical Specification (Implementation)

## 1. System Architecture Overview

```
+-------------------------------------------------------------------+
|  Tauri 2 Shell                                                     |
|  +--------------------------------------------------------------+ |
|  | SvelteKit 5 SPA                                               | |
|  |                                                               | |
|  |  +------------------+    +---------------------+              | |
|  |  | UI Components    |<---| Reactive Stores     |              | |
|  |  | (Svelte 5)       |    | ($lib/stores/)      |              | |
|  |  | - MapView        |    | - memberStore       |              | |
|  |  | - MemberList     |    | - placeStore        |              | |
|  |  | - PlaceEditor    |    | - historyStore      |              | |
|  |  | - HistoryView    |    | - syncStore         |              | |
|  |  +------------------+    +----------+----------+              | |
|  |                                     |                         | |
|  |                          +----------v----------+              | |
|  |                          | DB Layer            |              | |
|  |                          | ($lib/db/)          |              | |
|  |                          | - migrations        |              | |
|  |                          | - queries           |              | |
|  |                          +----------+----------+              | |
|  |                                     |                         | |
|  |                          +----------v----------+              | |
|  |                          | API Layer           |              | |
|  |                          | ($lib/api/)         |              | |
|  |                          | - interface (types) |              | |
|  |                          | - mock impl         |              | |
|  |                          | - sync service      |              | |
|  |                          +---------------------+              | |
|  +--------------------------------------------------------------+ |
|  +--------------------------------------------------------------+ |
|  | Tauri Plugins                                                 | |
|  | - @tauri-apps/plugin-sql (SQLite)                             | |
|  | - @tauri-apps/plugin-geolocation (GPS)                        | |
|  +--------------------------------------------------------------+ |
+-------------------------------------------------------------------+
         |                              |
         v                              v
   SQLite File                    Remote API (mocked)
   (local disk)                   (future: real server)
```

### Data Flow

1. **Inbound (receiving family locations):** API poll/push -> `$lib/api/` -> write to SQLite -> store reactively reads -> UI updates
2. **Outbound (own location):** Tauri GPS plugin -> write to SQLite (synced=false) -> sync service reads unsynced -> sends to API -> marks synced=true
3. **Offline read:** UI -> store -> reads from SQLite (all data already local)

## 2. File Structure

```
src/
  lib/
    api/
      types.ts          # API interface & request/response types
      mock.ts           # Mock implementation of API interface
      index.ts          # Exports active implementation (mock or real)
      sync.ts           # Sync service: pushes unsynced locations, pulls family updates
    db/
      index.ts          # DB initialization, migration runner
      migrations.ts     # SQL migration statements (versioned)
      queries.ts        # All SQL query functions (typed)
    stores/
      members.svelte.ts # Reactive member state (runes), reads from DB
      places.svelte.ts  # Reactive places/geofences state
      history.svelte.ts # Reactive history state for selected member/date
      sync.svelte.ts    # Sync status (online/offline, pending count, last sync time)
    geo/
      tracker.ts        # GPS tracking loop (start/stop, interval config)
      geofence.ts       # Geofence hit-testing (point-in-circle)
    auth.ts             # Existing Keycloak auth (retained, minor updates)
    config.ts           # App configuration (retained, extended)
  routes/
    +layout.svelte      # App shell: init DB, auth, GPS tracking, sync service
    +layout.ts          # SPA mode (ssr=false)
    +page.svelte        # Main view: map + sidebar
  components/
    Map.svelte          # Leaflet map wrapper
    MemberPin.svelte    # Map pin for a family member
    MemberList.svelte   # Sidebar member list
    MemberCard.svelte   # Single member row in list
    PlaceCircle.svelte  # Geofence circle on map
    PlaceEditor.svelte  # Create/edit a place (name, center, radius)
    PlaceList.svelte    # List of defined places
    HistoryTrail.svelte # Polyline trail on map for location history
    HistoryPanel.svelte # Date picker + timeline scrubber
    SyncBadge.svelte    # Online/offline indicator + pending count
    Header.svelte       # App header with menu
  app.html
  app.css               # Global styles (dark theme, Tailwind base)
```

## 3. API Interface {#api-interface}

### 3.1 TypeScript Interface

```typescript
// $lib/api/types.ts

export interface LatLng {
  lat: number;
  lng: number;
}

export interface LocationReport {
  memberId: string;
  lat: number;
  lng: number;
  accuracy: number;       // meters
  altitude: number | null;
  speed: number | null;    // m/s
  bearing: number | null;  // degrees
  battery: number | null;  // 0-100
  timestamp: string;       // ISO 8601 UTC
}

export interface MemberLocation {
  memberId: string;
  displayName: string;
  avatarUrl: string | null;
  lat: number;
  lng: number;
  accuracy: number;
  altitude: number | null;
  speed: number | null;
  bearing: number | null;
  battery: number | null;
  timestamp: string;       // ISO 8601 UTC
  isOnline: boolean;
}

export interface Place {
  id: string;
  name: string;
  lat: number;
  lng: number;
  radiusMeters: number;
  icon: string;            // emoji or icon identifier
  createdBy: string;       // memberId
  createdAt: string;       // ISO 8601 UTC
}

export interface PlaceCreate {
  name: string;
  lat: number;
  lng: number;
  radiusMeters: number;
  icon: string;
}

export interface PlaceUpdate {
  name?: string;
  lat?: number;
  lng?: number;
  radiusMeters?: number;
  icon?: string;
}

export interface HistoryQuery {
  memberId: string;
  date: string;            // YYYY-MM-DD
}

export interface HistoryPoint {
  lat: number;
  lng: number;
  accuracy: number;
  speed: number | null;
  timestamp: string;       // ISO 8601 UTC
}

export interface FamilyGroup {
  id: string;
  name: string;
  members: FamilyMember[];
}

export interface FamilyMember {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  role: 'admin' | 'member';
}

export interface LocationApi {
  // Family
  getFamily(): Promise<FamilyGroup>;

  // Locations - pull family members' current locations
  getFamilyLocations(): Promise<MemberLocation[]>;

  // Locations - push own location(s) to server
  reportLocations(reports: LocationReport[]): Promise<void>;

  // Locations - get history for a member on a given day
  getLocationHistory(query: HistoryQuery): Promise<HistoryPoint[]>;

  // Places (geofences)
  getPlaces(): Promise<Place[]>;
  createPlace(place: PlaceCreate): Promise<Place>;
  updatePlace(id: string, update: PlaceUpdate): Promise<Place>;
  deletePlace(id: string): Promise<void>;
}
```

### 3.2 Mock Implementation Behavior

The mock (`$lib/api/mock.ts`) implements `LocationApi` using in-memory data seeded on init:

| Method | Mock Behavior |
|--------|---------------|
| `getFamily()` | Returns hardcoded family with 4 members (Dad, Mum, Alice, Bob) |
| `getFamilyLocations()` | Returns positions near a configured center (e.g. Melbourne). Positions drift randomly each call to simulate movement |
| `reportLocations()` | No-op (accepts and discards). Returns resolved promise |
| `getLocationHistory()` | Generates a realistic path of 100-200 points for the requested date, simulating a day's movement |
| `getPlaces()` | Returns 3 hardcoded places: Home, School, Work with coordinates near configured center |
| `createPlace()` | Adds to in-memory array, returns with generated id |
| `updatePlace()` | Updates in-memory entry |
| `deletePlace()` | Removes from in-memory array |

### 3.3 API Selection

```typescript
// $lib/api/index.ts
import { MockLocationApi } from './mock';
import type { LocationApi } from './types';

// Future: switch based on config
// import { RealLocationApi } from './client';
// const USE_MOCK = import.meta.env.VITE_USE_MOCK_API !== 'false';

export const api: LocationApi = new MockLocationApi();
```

## 4. Component Architecture {#component-architecture}

### 4.1 Component Tree

```
+layout.svelte (init DB, auth, GPS tracker, sync service)
  +page.svelte (main app view)
    Header.svelte
      SyncBadge.svelte
    Map.svelte (Leaflet instance)
      MemberPin.svelte (x N, one per family member)
      PlaceCircle.svelte (x N, one per geofence)
      HistoryTrail.svelte (conditional, when viewing history)
    Sidebar (within +page.svelte, toggleable)
      MemberList.svelte
        MemberCard.svelte (x N)
      PlaceList.svelte
        PlaceEditor.svelte (modal/inline for create/edit)
      HistoryPanel.svelte (conditional, when member selected)
```

### 4.2 Component Specifications

| Component | Props | State (internal) | Key Behavior |
|-----------|-------|-------------------|-------------|
| `Map.svelte` | `members: MemberLocation[]`, `places: Place[]`, `historyTrail: HistoryPoint[] \| null`, `center: LatLng`, `zoom: number` | Leaflet map instance | Creates Leaflet map on mount. Fits bounds to show all members. Exposes `map` instance via context for children. |
| `MemberPin.svelte` | `member: MemberLocation` | tooltip open state | Leaflet marker with custom icon (avatar circle). Popup shows name, battery, last seen, speed. Color: green if online (<5min), yellow (<30min), gray (>30min). |
| `MemberList.svelte` | `members: MemberLocation[]`, `onSelect: (id: string) => void` | none | Sorted list: online first, then by name. Click selects member (centers map, opens history panel). |
| `MemberCard.svelte` | `member: MemberLocation`, `selected: boolean`, `onclick: () => void` | none | Shows avatar, name, address (reverse geocode or coords), last seen relative time, battery icon+%. |
| `PlaceCircle.svelte` | `place: Place`, `membersInside: string[]` | none | Leaflet circle overlay. Tooltip shows place name + count of members inside. Fill color based on occupancy. |
| `PlaceEditor.svelte` | `place: Place \| null`, `onSave: (p: PlaceCreate \| PlaceUpdate) => void`, `onCancel: () => void` | form fields | Modal form: name input, icon picker (emoji), radius slider (50m-2000m), click-on-map to set center. |
| `PlaceList.svelte` | `places: Place[]`, `onEdit: (id: string) => void`, `onDelete: (id: string) => void` | none | List of places with edit/delete actions. Shows member count currently inside each. |
| `HistoryTrail.svelte` | `points: HistoryPoint[]`, `currentIndex: number` | none | Leaflet polyline for full trail. Marker at `points[currentIndex]`. Color gradient from start (faded) to end (bright). |
| `HistoryPanel.svelte` | `memberId: string`, `onClose: () => void` | `selectedDate`, `scrubberIndex` | Date picker (calendar input). Loads history from DB for selected date. Slider scrubs through points. Play button animates. |
| `SyncBadge.svelte` | `online: boolean`, `pendingCount: number`, `lastSyncTime: string \| null` | none | Green dot if online, red if offline. Shows pending count as badge number. Tooltip shows last sync time. |
| `Header.svelte` | `familyName: string`, `username: string` | `menuOpen` | App title, hamburger menu (settings, logout), sync badge. |

### 4.3 Map Interaction Patterns

| Interaction | Behavior |
|-------------|----------|
| Initial load | Map fits bounds to show all family members with padding |
| Tap member pin | Opens popup with details. Sidebar scrolls to member card |
| Tap member in sidebar | Map flies to member position, opens popup |
| Long-press / right-click map | Opens "Create Place" at that position |
| Tap place circle | Opens popup with place name + who's inside |
| View history | Dims other members' pins. Shows trail polyline. Sidebar shows history panel |
| Exit history | Restores all member pins. Removes trail. Closes history panel |

## 5. Database Schema {#database-schema}

### 5.1 SQLite Tables

```sql
-- Migration 001: Initial schema

CREATE TABLE IF NOT EXISTS members (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  avatar_url TEXT,
  role TEXT NOT NULL DEFAULT 'member',  -- 'admin' | 'member'
  updated_at TEXT NOT NULL               -- ISO 8601
);

CREATE TABLE IF NOT EXISTS locations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id TEXT NOT NULL,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  accuracy REAL NOT NULL,
  altitude REAL,
  speed REAL,
  bearing REAL,
  battery INTEGER,
  timestamp TEXT NOT NULL,               -- ISO 8601 UTC, from GPS
  source TEXT NOT NULL,                  -- 'self' | 'remote'
  synced INTEGER NOT NULL DEFAULT 0,     -- 0=pending, 1=synced (only meaningful for source='self')
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (member_id) REFERENCES members(id)
);

CREATE INDEX IF NOT EXISTS idx_locations_member_time ON locations(member_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_locations_synced ON locations(synced) WHERE source = 'self';
CREATE INDEX IF NOT EXISTS idx_locations_source ON locations(source, member_id, timestamp);

CREATE TABLE IF NOT EXISTS places (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  radius_meters REAL NOT NULL,
  icon TEXT NOT NULL DEFAULT '📍',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (created_by) REFERENCES members(id)
);

CREATE TABLE IF NOT EXISTS sync_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
-- Keys: 'last_pull_time', 'last_push_time', 'device_id'
```

### 5.2 Migration Strategy

Migrations are versioned integer sequences in `$lib/db/migrations.ts`. On app start, `$lib/db/index.ts`:

1. Opens SQLite database via `@tauri-apps/plugin-sql`
2. Creates `_migrations` table if not exists (tracks applied version numbers)
3. Applies any unapplied migrations in order
4. Returns typed DB handle

```typescript
// $lib/db/migrations.ts
export const migrations: { version: number; sql: string }[] = [
  { version: 1, sql: `/* SQL from 5.1 above */` },
];
```

### 5.3 Query Functions

```typescript
// $lib/db/queries.ts - function signatures

// Members
getMembers(): Promise<Member[]>
upsertMember(member: Member): Promise<void>

// Locations - write
insertLocation(loc: LocationRow): Promise<number>  // returns id
insertLocations(locs: LocationRow[]): Promise<void> // batch insert
markSynced(ids: number[]): Promise<void>

// Locations - read
getLatestLocations(): Promise<MemberLocationRow[]>  // latest per member
getUnsyncedLocations(): Promise<LocationRow[]>       // source='self', synced=0
getLocationHistory(memberId: string, date: string): Promise<LocationRow[]>  // all points for member on date

// Places
getPlaces(): Promise<PlaceRow[]>
upsertPlace(place: PlaceRow): Promise<void>
deletePlace(id: string): Promise<void>

// Sync meta
getSyncMeta(key: string): Promise<string | null>
setSyncMeta(key: string, value: string): Promise<void>
```

## 6. Offline Sync Design {#offline-sync}

### 6.1 Architecture

```
Online:
  GPS tick -> insert(source='self', synced=0) -> sync pushes -> mark synced=1
  API poll -> receive family locations -> insert(source='remote')

Offline:
  GPS tick -> insert(source='self', synced=0)  [accumulates]
  No API poll (fails silently)

Reconnect:
  Sync service detects online -> queries unsynced -> batch POST with original timestamps -> mark synced
  Resumes polling for family locations
```

### 6.2 Sync Service Behavior

| Parameter | Value |
|-----------|-------|
| Poll interval (online) | 15 seconds |
| GPS recording interval | 30 seconds |
| Sync batch size | 100 locations max per request |
| Online detection | `navigator.onLine` + API health check on change |
| Retry on failure | 3 attempts with exponential backoff (2s, 4s, 8s), then wait for next poll cycle |

### 6.3 Sync Service Lifecycle

```typescript
// $lib/api/sync.ts

class SyncService {
  private pullInterval: number | null = null;
  private online: boolean = navigator.onLine;

  start(): void       // Begin poll loop + listen for online/offline events
  stop(): void        // Clear intervals, remove listeners
  pushUnsynced(): Promise<void>   // Query unsynced, batch send, mark synced
  pullFamily(): Promise<void>     // Fetch family locations, write to DB
  onOnline(): void    // Triggered by 'online' event: immediate push + pull
  onOffline(): void   // Triggered by 'offline' event: stop pull loop
}
```

### 6.4 Store-to-DB Reactive Pattern

Stores do not hold independent state. They are reactive windows into SQLite:

```typescript
// $lib/stores/members.svelte.ts (pattern)

let members = $state<MemberLocation[]>([]);

export function getMemberLocations() { return members; }

export async function refreshMembers(): Promise<void> {
  members = await getLatestLocations();  // reads from SQLite
}

// Called by sync service after every pull, and on app init
```

The sync service calls `refreshMembers()` / `refreshPlaces()` after each DB write, which triggers reactive UI updates.

## 7. GPS Tracker {#gps-tracker}

### 7.1 Behavior

```typescript
// $lib/geo/tracker.ts

class GpsTracker {
  private intervalId: number | null = null;
  private intervalMs: number = 30_000;  // 30 seconds

  async start(): Promise<void>    // Request permission, begin interval
  stop(): void                     // Clear interval
  private async tick(): Promise<void>  // Get position, insert to DB, trigger store refresh
}
```

### 7.2 Geofence Detection

```typescript
// $lib/geo/geofence.ts

// Pure function: given a point and list of places, returns which places the point is inside
function detectGeofences(point: LatLng, places: Place[]): Place[]

// Uses Haversine formula for distance calculation
function haversineDistance(a: LatLng, b: LatLng): number  // returns meters
```

Geofence detection runs client-side on each member location update. No server-side geofence processing.

## 8. UI Theme & Layout {#ui-theme}

### 8.1 Layout Structure (Mobile-First)

```
+----------------------------------+
| Header (family name, sync badge) |
+----------------------------------+
|                                  |
|           Map (full)             |
|                                  |
|                                  |
+----------------------------------+
| Bottom Sheet (draggable)         |
|  - Member list (collapsed)       |
|  - Pull up for full list         |
|  - Places tab                    |
|  - History panel (when active)   |
+----------------------------------+
```

Desktop (>768px): Sidebar on left (320px), map fills remaining width.

### 8.2 Color Palette (Dark Theme)

| Token | Value | Usage |
|-------|-------|-------|
| `bg-primary` | `#0f0f1a` | Page background |
| `bg-surface` | `#1a1a2e` | Cards, panels |
| `bg-surface-hover` | `#252540` | Interactive hover |
| `border-subtle` | `rgba(255,255,255,0.08)` | Card borders |
| `text-primary` | `#e0e0e0` | Primary text |
| `text-secondary` | `#8b8b9e` | Secondary text |
| `text-muted` | `#6b6b7e` | Timestamps, labels |
| `accent-blue` | `#4a90e2` | Active states, links |
| `status-online` | `#4caf50` | Online indicator |
| `status-stale` | `#ff9800` | Seen <30min ago |
| `status-offline` | `#757575` | Seen >30min ago |
| `geofence-fill` | `rgba(74,144,226,0.15)` | Place circle fill |
| `geofence-stroke` | `#4a90e2` | Place circle border |

### 8.3 Existing Theme Retention

The existing `app.css` dark theme (Inter font, gradient background, glassmorphism cards) is retained and extended. The color palette above aligns with the existing design language.

## 9. Anti-Patterns (DO NOT) {#anti-patterns}

| # | Don't | Do Instead | Why |
|---|-------|------------|-----|
| 1 | Store location state only in Svelte runes | Write to SQLite first, runes read from DB | Runes are ephemeral; DB survives app restart and provides offline persistence |
| 2 | Use `new Date()` or local timezone for timestamps | Use ISO 8601 UTC strings everywhere (`new Date().toISOString()`) | Timezone bugs, SQLite sort order, server sync consistency |
| 3 | Poll API without checking online status | Check `navigator.onLine` and handle fetch errors gracefully | Avoids error spam and unnecessary network requests when offline |
| 4 | Create Leaflet map instance in reactive block (`$effect`) | Create map in `onMount`, update markers/layers in `$effect` | Leaflet map is imperative; recreating it causes flicker, memory leaks |
| 5 | Import `leaflet` at module top-level | Dynamic import `leaflet` inside `onMount` (it accesses `window`) | SSR/SSG will crash on `window` reference even with `ssr: false` |
| 6 | Store large blobs (avatars) in SQLite | Store URL strings only; cache images via HTTP cache | SQLite bloat, slow queries, memory pressure |
| 7 | Sync all historical locations on every push | Only sync `WHERE synced = 0 AND source = 'self'` | Bandwidth waste, duplicate data on server |
| 8 | Hardcode mock data in components | All data flows through stores, mock lives in `$lib/api/mock.ts` only | Components must not know about mock vs real |
| 9 | Use `setInterval` for GPS without cleanup | Use `onMount` return / `onDestroy` to clear intervals | Memory leaks, background GPS after navigation |
| 10 | Trust `navigator.onLine` alone for connectivity | Treat it as hint; confirm with actual API health check on `online` event | `navigator.onLine` can be true but API unreachable |

## 10. Test Case Specifications {#test-case-specifications}

### Unit Tests

| Test ID | Component | Input | Expected Output | Edge Cases |
|---------|-----------|-------|-----------------|------------|
| TC-001 | `haversineDistance` | Two known coords (Melbourne CBD to St Kilda) | ~6200m (within 50m tolerance) | Same point (0m), antipodal points |
| TC-002 | `detectGeofences` | Point inside 1 of 3 circles | Returns array with 1 matching place | Point on boundary, point in 0 circles, point in overlapping circles |
| TC-003 | `getUnsyncedLocations` query | DB with 5 self-unsynced, 3 self-synced, 4 remote | Returns only the 5 unsynced self rows | Empty DB, all synced, no self rows |
| TC-004 | `getLatestLocations` query | DB with multiple timestamps per member | Returns 1 row per member (latest timestamp) | Member with single entry, member with no entries |
| TC-005 | `getLocationHistory` query | memberId + date with 150 points | Returns 150 points ordered by timestamp ASC | Date with 0 points, member that doesn't exist |
| TC-006 | `markSynced` | Array of 3 location IDs | Those 3 rows now have synced=1 | Empty array, IDs that don't exist |
| TC-007 | Mock `getFamilyLocations` | No input | Returns 4 members with valid coords, battery 0-100 | Called multiple times returns different positions (drift) |
| TC-008 | Migration runner | Fresh DB | All tables created, `_migrations` records version 1 | Already migrated DB (no-op), partially migrated |

### Integration Tests

| Test ID | Flow | Setup | Verification | Teardown |
|---------|------|-------|--------------|----------|
| IT-001 | GPS record -> DB persist | Init DB, start tracker | After tick: `locations` table has 1 row with source='self', synced=0 | Stop tracker, close DB |
| IT-002 | Sync push flow | Insert 5 unsynced locations | After `pushUnsynced()`: all 5 marked synced=1, `reportLocations` called with 5 items | Reset DB |
| IT-003 | Sync pull flow | Empty members table | After `pullFamily()`: members table has entries, latest locations stored | Reset DB |
| IT-004 | Offline -> online sync | Insert 10 unsynced, simulate offline then online | On 'online' event: all 10 pushed, marked synced | Reset DB |
| IT-005 | Full UI render | Init DB with seed data | Map renders, 4 pins visible, member list shows 4 cards, 3 place circles on map | Destroy component |

## 11. Error Handling Matrix {#error-handling-matrix}

### GPS Errors

| Error Type | Detection | Response | Fallback | Logging |
|------------|-----------|----------|----------|---------|
| Permission denied | `GeolocationPositionError.PERMISSION_DENIED` | Show persistent banner: "Location permission required" | Stop tracker, app works in view-only mode (can see family, can't share own location) | WARN |
| Position unavailable | `GeolocationPositionError.POSITION_UNAVAILABLE` | Skip this tick, retry on next interval | Use last known position (do not insert duplicate) | WARN |
| Timeout | `GeolocationPositionError.TIMEOUT` | Skip this tick | Same as above | DEBUG |

### Database Errors

| Error Type | Detection | Response | Fallback | Logging |
|------------|-----------|----------|----------|---------|
| DB open failure | `Database.load()` throws | Show error screen: "Failed to open database" | App cannot function without DB. Show retry button. | ERROR |
| Migration failure | SQL execution throws | Show error screen with migration version that failed | App cannot function. Show "Clear data & retry" option. | ERROR |
| Write failure (disk full) | INSERT throws | Show toast: "Storage full" | Skip write, continue operating from existing data | ERROR |
| Query failure | SELECT throws | Return empty array, show toast | UI shows "No data available" | ERROR |

### Network/API Errors

| Error Type | Detection | Response | Fallback | Logging |
|------------|-----------|----------|----------|---------|
| API unreachable | `fetch` throws / timeout >5s | Set sync status to offline | Continue with local data. Queue continues accumulating. | WARN (once, not every tick) |
| 401 Unauthorized | Response status 401 | Trigger Keycloak token refresh | If refresh fails, prompt re-login | WARN |
| 429 Rate limited | Response status 429 | Back off: double poll interval temporarily | Use cached data | WARN |
| 500 Server error | Response status 500 | Retry once after 5s, then skip cycle | Use cached data | ERROR |
| Partial batch failure | Server accepts some locations, rejects others | Mark accepted as synced, keep rejected as unsynced | Retry rejected on next cycle | WARN |

### Auth Errors

| Error Type | Detection | Response | Fallback | Logging |
|------------|-----------|----------|----------|---------|
| Keycloak init failure | `initKeycloak()` throws | Show auth error banner (existing behavior) | App shows limited UI: map with local data only | ERROR |
| Token refresh failure | `updateToken()` throws | Prompt user to log in again | Pause sync, continue with local data | WARN |
| Session expired | Keycloak `onAuthLogout` | Redirect to login screen | Pause sync | INFO |

## 12. References {#references}

| Topic | Location | Anchor |
|-------|----------|--------|
| Strategic decisions | [Strategic Blueprint](./01-strategic-blueprint.md) | Full document |
| ADR-001 Map Library | [Strategic Blueprint, Section 4](./01-strategic-blueprint.md#4-core-architecture-decision) | ADR-001 |
| ADR-002 API Mocking | [Strategic Blueprint, Section 4](./01-strategic-blueprint.md#4-core-architecture-decision) | ADR-002 |
| ADR-003 State Management | [Strategic Blueprint, Section 4](./01-strategic-blueprint.md#4-core-architecture-decision) | ADR-003 |
| ADR-004 Offline Sync | [Strategic Blueprint, Section 4](./01-strategic-blueprint.md#4-core-architecture-decision) | ADR-004 |
| MVP feature list | [Strategic Blueprint, Section 6](./01-strategic-blueprint.md#6-mvp-features) | Feature table |
| Exclusions | [Strategic Blueprint, Section 7](./01-strategic-blueprint.md#7-explicit-exclusions-not-building) | Exclusion table |
| SQLite table schemas | [Schema Reference, Section 1](./03-schema-reference.md#sqlite-tables) | Column details, indexes |
| TypeScript types | [Schema Reference, Section 2](./03-schema-reference.md#typescript-types) | API, DB row, store types |
| Type mapping rules | [Schema Reference, Section 3](./03-schema-reference.md#type-mapping) | camelCase/snake_case, timestamps, IDs |
| Value constraints | [Schema Reference, Section 4](./03-schema-reference.md#constraints) | Min/max/units for all fields |
