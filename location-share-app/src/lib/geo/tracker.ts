import { getDatabase } from '$lib/db/index';
import { insertLocation } from '$lib/db/queries';
import { refreshMembers } from '$lib/stores/members.svelte';

const GPS_INTERVAL_MS = 30_000;

export class GpsTracker {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private memberId: string;

  constructor(memberId: string) {
    this.memberId = memberId;
  }

  async start(): Promise<void> {
    // Immediate first tick
    await this.tick();
    this.intervalId = setInterval(() => this.tick(), GPS_INTERVAL_MS);
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  private async tick(): Promise<void> {
    try {
      const position = await this.getPosition();
      const db = getDatabase();
      if (!db) return;

      await insertLocation(db, {
        member_id: this.memberId,
        lat: position.coords.latitude,
        lng: position.coords.longitude,
        accuracy: position.coords.accuracy,
        altitude: position.coords.altitude,
        speed: position.coords.speed,
        bearing: position.coords.heading,
        battery: null,
        timestamp: new Date(position.timestamp).toISOString(),
        source: 'self',
        synced: 0,
      });

      await refreshMembers();
    } catch (e) {
      // Permission denied or position unavailable - skip this tick
      console.warn('[GPS] Tick failed:', e);
    }
  }

  private getPosition(): Promise<GeolocationPosition> {
    return new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true,
        timeout: 10_000,
        maximumAge: 5_000,
      });
    });
  }
}
