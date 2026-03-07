export const migrations: { version: number; sql: string }[] = [
  {
    version: 1,
    sql: `
CREATE TABLE IF NOT EXISTS members (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  avatar_url TEXT,
  role TEXT NOT NULL DEFAULT 'member',
  updated_at TEXT NOT NULL
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
  timestamp TEXT NOT NULL,
  source TEXT NOT NULL,
  synced INTEGER NOT NULL DEFAULT 0,
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
    `,
  },
];
