import type { Database } from './index';

export interface MemberRow {
  id: string;
  display_name: string;
  avatar_url: string | null;
  role: string;
  updated_at: string;
}

export interface LocationRow {
  id: number;
  member_id: string;
  lat: number;
  lng: number;
  accuracy: number;
  altitude: number | null;
  speed: number | null;
  bearing: number | null;
  battery: number | null;
  timestamp: string;
  source: string;
  synced: number;
  created_at: string;
}

export interface PlaceRow {
  id: string;
  name: string;
  lat: number;
  lng: number;
  radius_meters: number;
  icon: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface MemberLocationRow {
  id: string;
  display_name: string;
  avatar_url: string | null;
  role: string;
  lat: number;
  lng: number;
  accuracy: number;
  altitude: number | null;
  speed: number | null;
  bearing: number | null;
  battery: number | null;
  timestamp: string;
}

export interface SyncMetaRow {
  key: string;
  value: string;
}

export async function getMembers(db: Database): Promise<MemberRow[]> {
  return db.select<MemberRow[]>('SELECT * FROM members');
}

export async function upsertMember(db: Database, member: MemberRow): Promise<void> {
  await db.execute(
    `INSERT INTO members (id, display_name, avatar_url, role, updated_at)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT(id) DO UPDATE SET
       display_name = excluded.display_name,
       avatar_url = excluded.avatar_url,
       role = excluded.role,
       updated_at = excluded.updated_at`,
    [member.id, member.display_name, member.avatar_url, member.role, member.updated_at],
  );
}

export async function insertLocation(
  db: Database,
  loc: Omit<LocationRow, 'id' | 'created_at'>,
): Promise<number> {
  const result = await db.execute(
    `INSERT INTO locations (member_id, lat, lng, accuracy, altitude, speed, bearing, battery, timestamp, source, synced)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [loc.member_id, loc.lat, loc.lng, loc.accuracy, loc.altitude, loc.speed, loc.bearing, loc.battery, loc.timestamp, loc.source, loc.synced],
  );
  return result.lastInsertId;
}

export async function insertLocations(
  db: Database,
  locs: Omit<LocationRow, 'id' | 'created_at'>[],
): Promise<void> {
  if (locs.length === 0) return;

  // Batch insert using a single statement with multiple value sets
  const placeholdersPerRow = 11;
  const valueClauses: string[] = [];
  const params: unknown[] = [];

  for (let i = 0; i < locs.length; i++) {
    const offset = i * placeholdersPerRow;
    valueClauses.push(
      `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8}, $${offset + 9}, $${offset + 10}, $${offset + 11})`,
    );
    const loc = locs[i];
    params.push(loc.member_id, loc.lat, loc.lng, loc.accuracy, loc.altitude, loc.speed, loc.bearing, loc.battery, loc.timestamp, loc.source, loc.synced);
  }

  await db.execute(
    `INSERT INTO locations (member_id, lat, lng, accuracy, altitude, speed, bearing, battery, timestamp, source, synced)
     VALUES ${valueClauses.join(', ')}`,
    params,
  );
}

export async function markSynced(db: Database, ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  const placeholders = ids.map((_, i) => `$${i + 1}`).join(',');
  await db.execute(`UPDATE locations SET synced = 1 WHERE id IN (${placeholders})`, ids);
}

export async function getLatestLocations(db: Database): Promise<MemberLocationRow[]> {
  return db.select<MemberLocationRow[]>(
    `SELECT m.id, m.display_name, m.avatar_url, m.role,
            l.lat, l.lng, l.accuracy, l.altitude, l.speed, l.bearing, l.battery, l.timestamp
     FROM members m
     INNER JOIN locations l ON l.member_id = m.id
     INNER JOIN (
       SELECT member_id, MAX(timestamp) as max_ts
       FROM locations
       GROUP BY member_id
     ) latest ON l.member_id = latest.member_id AND l.timestamp = latest.max_ts`,
  );
}

export async function getUnsyncedLocations(db: Database): Promise<LocationRow[]> {
  return db.select<LocationRow[]>(
    `SELECT * FROM locations WHERE source = 'self' AND synced = 0 ORDER BY timestamp ASC`,
  );
}

export async function getLocationHistory(
  db: Database,
  memberId: string,
  date: string,
): Promise<LocationRow[]> {
  // Use next day for exclusive upper bound to capture all points in the day
  const nextDay = new Date(date + 'T00:00:00.000Z');
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  return db.select<LocationRow[]>(
    `SELECT * FROM locations
     WHERE member_id = $1 AND timestamp >= $2 AND timestamp < $3
     ORDER BY timestamp ASC`,
    [memberId, date + 'T00:00:00.000Z', nextDay.toISOString()],
  );
}

export async function getPlaces(db: Database): Promise<PlaceRow[]> {
  return db.select<PlaceRow[]>('SELECT * FROM places');
}

export async function upsertPlace(db: Database, place: PlaceRow): Promise<void> {
  await db.execute(
    `INSERT INTO places (id, name, lat, lng, radius_meters, icon, created_by, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       lat = excluded.lat,
       lng = excluded.lng,
       radius_meters = excluded.radius_meters,
       icon = excluded.icon,
       updated_at = excluded.updated_at`,
    [place.id, place.name, place.lat, place.lng, place.radius_meters, place.icon, place.created_by, place.created_at, place.updated_at],
  );
}

export async function deletePlace(db: Database, id: string): Promise<void> {
  await db.execute('DELETE FROM places WHERE id = $1', [id]);
}

export async function getSyncMeta(db: Database, key: string): Promise<string | null> {
  const rows = await db.select<SyncMetaRow[]>(
    'SELECT value FROM sync_meta WHERE key = $1',
    [key],
  );
  return rows.length > 0 ? rows[0].value : null;
}

export async function setSyncMeta(db: Database, key: string, value: string): Promise<void> {
  await db.execute(
    `INSERT INTO sync_meta (key, value) VALUES ($1, $2)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [key, value],
  );
}

export async function getUnsyncedCount(db: Database): Promise<number> {
  const rows = await db.select<{ count: number }[]>(
    `SELECT COUNT(*) as count FROM locations WHERE source = 'self' AND synced = 0`,
  );
  return rows[0]?.count ?? 0;
}
