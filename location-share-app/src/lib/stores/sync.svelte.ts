export interface SyncState {
  online: boolean;
  pendingCount: number;
  lastSyncTime: string | null;
}

let syncState = $state<SyncState>({
  online: typeof navigator !== 'undefined' ? navigator.onLine : true,
  pendingCount: 0,
  lastSyncTime: null,
});

export function getSyncState(): SyncState {
  return syncState;
}

export function setOnline(online: boolean): void {
  syncState = { ...syncState, online };
}

export function setPendingCount(count: number): void {
  syncState = { ...syncState, pendingCount: count };
}

export function setLastSyncTime(time: string): void {
  syncState = { ...syncState, lastSyncTime: time };
}
