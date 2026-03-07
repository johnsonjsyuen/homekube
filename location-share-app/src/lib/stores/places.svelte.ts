import type { Place } from '$lib/api/types';
import { getDatabase } from '$lib/db/index';
import { getPlaces as dbGetPlaces, type PlaceRow } from '$lib/db/queries';

function rowToPlace(row: PlaceRow): Place {
  return {
    id: row.id,
    name: row.name,
    lat: row.lat,
    lng: row.lng,
    radiusMeters: row.radius_meters,
    icon: row.icon,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

let places = $state<Place[]>([]);

export function getPlacesList(): Place[] {
  return places;
}

export function setPlaces(newPlaces: Place[]): void {
  places = newPlaces;
}

export async function refreshPlaces(): Promise<void> {
  const db = getDatabase();
  if (!db) return;
  try {
    const rows = await dbGetPlaces(db);
    places = rows.map(rowToPlace);
  } catch (e) {
    console.error('[Store] Failed to refresh places:', e);
  }
}
