import { api } from './index';
import { getDatabase } from '$lib/db/index';
import {
  getUnsyncedLocations,
  markSynced,
  insertLocations,
  upsertMember,
  upsertPlace,
  getUnsyncedCount,
  setSyncMeta,
} from '$lib/db/queries';
import { refreshMembers, setMemberLocations } from '$lib/stores/members.svelte';
import { refreshPlaces, setPlaces } from '$lib/stores/places.svelte';
import { setOnline, setPendingCount, setLastSyncTime } from '$lib/stores/sync.svelte';
import type { LocationReport } from './types';

const POLL_INTERVAL = 15_000;
const BATCH_SIZE = 100;
const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 2_000;

async function withRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e;
      if (attempt < MAX_RETRIES - 1) {
        const delay = BASE_BACKOFF_MS * Math.pow(2, attempt);
        console.warn(`[Sync] ${label} attempt ${attempt + 1} failed, retrying in ${delay}ms`);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  throw lastError;
}

export class SyncService {
  private pullInterval: ReturnType<typeof setInterval> | null = null;
  private online: boolean = navigator.onLine;
  private boundOnline = () => this.onOnline();
  private boundOffline = () => this.onOffline();

  start(): void {
    window.addEventListener('online', this.boundOnline);
    window.addEventListener('offline', this.boundOffline);

    this.online = navigator.onLine;
    setOnline(this.online);

    // Immediate first pull
    this.pullFamily();
    this.pushUnsynced();

    if (this.online) {
      this.startPollLoop();
    }
  }

  stop(): void {
    this.stopPollLoop();
    window.removeEventListener('online', this.boundOnline);
    window.removeEventListener('offline', this.boundOffline);
  }

  private startPollLoop(): void {
    if (this.pullInterval) return;
    this.pullInterval = setInterval(() => {
      this.pullFamily();
      this.pushUnsynced();
    }, POLL_INTERVAL);
  }

  private stopPollLoop(): void {
    if (this.pullInterval) {
      clearInterval(this.pullInterval);
      this.pullInterval = null;
    }
  }

  async pushUnsynced(): Promise<void> {
    const db = getDatabase();
    if (!db) return;

    try {
      const unsynced = await getUnsyncedLocations(db);
      if (unsynced.length === 0) return;

      // Batch
      for (let i = 0; i < unsynced.length; i += BATCH_SIZE) {
        const batch = unsynced.slice(i, i + BATCH_SIZE);
        const reports: LocationReport[] = batch.map((loc) => ({
          memberId: loc.member_id,
          lat: loc.lat,
          lng: loc.lng,
          accuracy: loc.accuracy,
          altitude: loc.altitude,
          speed: loc.speed,
          bearing: loc.bearing,
          battery: loc.battery,
          timestamp: loc.timestamp,
        }));

        await withRetry(() => api.reportLocations(reports), 'push');
        await markSynced(db, batch.map((l) => l.id));
      }

      const now = new Date().toISOString();
      await setSyncMeta(db, 'last_push_time', now);
      setLastSyncTime(now);

      const remaining = await getUnsyncedCount(db);
      setPendingCount(remaining);
    } catch (e) {
      console.warn('[Sync] Push failed after retries:', e);
    }
  }

  async pullFamily(): Promise<void> {
    const db = getDatabase();

    try {
      // Pull family member metadata
      const family = await withRetry(() => api.getFamily(), 'pull-family');
      if (db) {
        const now = new Date().toISOString();
        for (const member of family.members) {
          await upsertMember(db, {
            id: member.id,
            display_name: member.displayName,
            avatar_url: member.avatarUrl,
            role: member.role,
            updated_at: now,
          });
        }
      }

      // Pull current locations
      const locations = await withRetry(() => api.getFamilyLocations(), 'pull-locations');
      if (db) {
        await insertLocations(
          db,
          locations.map((loc) => ({
            member_id: loc.memberId,
            lat: loc.lat,
            lng: loc.lng,
            accuracy: loc.accuracy,
            altitude: loc.altitude,
            speed: loc.speed,
            bearing: loc.bearing,
            battery: loc.battery,
            timestamp: loc.timestamp,
            source: 'remote' as const,
            synced: 1,
          })),
        );
        await refreshMembers();
      } else {
        // No DB - set store directly from API
        setMemberLocations(locations);
      }

      // Pull places
      const places = await withRetry(() => api.getPlaces(), 'pull-places');
      if (db) {
        const now = new Date().toISOString();
        for (const place of places) {
          await upsertPlace(db, {
            id: place.id,
            name: place.name,
            lat: place.lat,
            lng: place.lng,
            radius_meters: place.radiusMeters,
            icon: place.icon,
            created_by: place.createdBy,
            created_at: place.createdAt,
            updated_at: now,
          });
        }
        await refreshPlaces();
      } else {
        setPlaces(places);
      }

      if (db) {
        const now = new Date().toISOString();
        await setSyncMeta(db, 'last_pull_time', now);
        setLastSyncTime(now);
      }
    } catch (e) {
      console.warn('[Sync] Pull failed after retries:', e);
    }
  }

  async onOnline(): Promise<void> {
    this.online = true;
    setOnline(true);

    // Verify API is actually reachable before resuming full sync
    try {
      await api.getFamily();
    } catch {
      console.warn('[Sync] API health check failed on reconnect, will retry next cycle');
      this.startPollLoop();
      return;
    }

    this.pushUnsynced();
    this.pullFamily();
    this.startPollLoop();
  }

  onOffline(): void {
    this.online = false;
    setOnline(false);
    this.stopPollLoop();
  }
}
