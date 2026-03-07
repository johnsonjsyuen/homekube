import type { MemberLocation } from '$lib/api/types';
import { getDatabase } from '$lib/db/index';
import { getLatestLocations, type MemberLocationRow } from '$lib/db/queries';

function isOnline(timestamp: string): boolean {
  return Date.now() - new Date(timestamp).getTime() < 5 * 60 * 1000;
}

function rowToMemberLocation(row: MemberLocationRow): MemberLocation {
  return {
    memberId: row.id,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    lat: row.lat,
    lng: row.lng,
    accuracy: row.accuracy,
    altitude: row.altitude,
    speed: row.speed,
    bearing: row.bearing,
    battery: row.battery,
    timestamp: row.timestamp,
    isOnline: isOnline(row.timestamp),
  };
}

let members = $state<MemberLocation[]>([]);

export function getMemberLocations(): MemberLocation[] {
  return members;
}

export function setMemberLocations(locations: MemberLocation[]): void {
  members = locations;
}

export async function refreshMembers(): Promise<void> {
  const db = getDatabase();
  if (!db) return;
  try {
    const rows = await getLatestLocations(db);
    members = rows.map(rowToMemberLocation);
  } catch (e) {
    console.error('[Store] Failed to refresh members:', e);
  }
}
