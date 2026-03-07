import type { HistoryPoint } from '$lib/api/types';
import { getDatabase } from '$lib/db/index';
import { getLocationHistory } from '$lib/db/queries';

let historyPoints = $state<HistoryPoint[]>([]);
let activeMemberId = $state<string | null>(null);
let activeDate = $state<string | null>(null);

export function getHistory(): HistoryPoint[] {
  return historyPoints;
}

export function getActiveMemberId(): string | null {
  return activeMemberId;
}

export function getActiveDate(): string | null {
  return activeDate;
}

export async function loadHistory(memberId: string, date: string): Promise<void> {
  activeMemberId = memberId;
  activeDate = date;

  const db = getDatabase();
  if (!db) return;

  try {
    const rows = await getLocationHistory(db, memberId, date);
    historyPoints = rows.map((r) => ({
      lat: r.lat,
      lng: r.lng,
      accuracy: r.accuracy,
      speed: r.speed,
      timestamp: r.timestamp,
    }));
  } catch (e) {
    console.error('[Store] Failed to load history:', e);
    historyPoints = [];
  }
}

export function clearHistory(): void {
  historyPoints = [];
  activeMemberId = null;
  activeDate = null;
}
