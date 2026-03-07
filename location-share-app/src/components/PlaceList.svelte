<script lang="ts">
  import type { Place, MemberLocation } from '$lib/api/types';
  import { detectGeofences } from '$lib/geo/geofence';

  let { places, members, onEdit, onDelete }: {
    places: Place[];
    members: MemberLocation[];
    onEdit: (id: string) => void;
    onDelete: (id: string) => void;
  } = $props();

  function getMembersInPlace(place: Place): string[] {
    return members
      .filter((m) => detectGeofences({ lat: m.lat, lng: m.lng }, [place]).length > 0)
      .map((m) => m.displayName);
  }
</script>

<div class="place-list">
  <div class="place-list-header">
    <span class="place-list-title">Places</span>
    <span class="place-count">{places.length}</span>
  </div>
  {#each places as place (place.id)}
    {@const insideNames = getMembersInPlace(place)}
    <div class="place-item">
      <div class="place-icon">{place.icon}</div>
      <div class="place-info">
        <div class="place-name">{place.name}</div>
        <div class="place-detail">
          {place.radiusMeters}m radius
          {#if insideNames.length > 0}
            <span class="place-members">{insideNames.join(', ')}</span>
          {/if}
        </div>
      </div>
      <div class="place-actions">
        <button class="action-btn" onclick={() => onEdit(place.id)} title="Edit">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
          </svg>
        </button>
        <button class="action-btn delete" onclick={() => onDelete(place.id)} title="Delete">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          </svg>
        </button>
      </div>
    </div>
  {/each}
</div>

<style>
  .place-list {
    display: flex;
    flex-direction: column;
  }

  .place-list-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 12px;
  }

  .place-list-title {
    font-size: 0.8rem;
    font-weight: 600;
    color: #8b8b9e;
    text-transform: uppercase;
    letter-spacing: 1px;
  }

  .place-count {
    font-size: 0.7rem;
    background: rgba(255, 255, 255, 0.08);
    color: #8b8b9e;
    padding: 2px 8px;
    border-radius: 10px;
  }

  .place-item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 12px;
    border-radius: 10px;
    transition: background 0.15s;
  }

  .place-item:hover {
    background: rgba(255, 255, 255, 0.04);
  }

  .place-icon {
    font-size: 1.4rem;
    flex-shrink: 0;
  }

  .place-info {
    flex: 1;
    min-width: 0;
  }

  .place-name {
    font-size: 0.85rem;
    font-weight: 500;
    color: #e0e0e0;
  }

  .place-detail {
    font-size: 0.75rem;
    color: #6b6b7e;
    margin-top: 2px;
  }

  .place-members {
    color: #4a90e2;
    margin-left: 4px;
  }

  .place-actions {
    display: flex;
    gap: 4px;
  }

  .action-btn {
    background: none;
    border: none;
    color: #6b6b7e;
    cursor: pointer;
    padding: 4px;
    border-radius: 6px;
    transition: all 0.15s;
    display: flex;
    align-items: center;
  }

  .action-btn:hover {
    background: rgba(255, 255, 255, 0.08);
    color: #e0e0e0;
  }

  .action-btn.delete:hover {
    background: rgba(255, 82, 82, 0.12);
    color: #ff6b6b;
  }
</style>
