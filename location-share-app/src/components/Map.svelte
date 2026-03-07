<script lang="ts">
  import type { MemberLocation, Place, HistoryPoint } from '$lib/api/types';
  import { onMount, onDestroy, setContext } from 'svelte';
  import { detectGeofences } from '$lib/geo/geofence';
  import MemberPin from './MemberPin.svelte';
  import PlaceCircle from './PlaceCircle.svelte';
  import HistoryTrail from './HistoryTrail.svelte';
  import type L from 'leaflet';

  let { members, places, historyTrail = null, historyIndex = 0, center, zoom = 13,
    viewingHistoryMemberId = null, onMemberClick, onMapRightClick }: {
    members: MemberLocation[];
    places: Place[];
    historyTrail?: HistoryPoint[] | null;
    historyIndex?: number;
    center: { lat: number; lng: number };
    zoom?: number;
    viewingHistoryMemberId?: string | null;
    onMemberClick?: (id: string) => void;
    onMapRightClick?: (lat: number, lng: number) => void;
  } = $props();

  let mapContainer: HTMLDivElement;
  let map: L.Map | null = null;
  let leaflet: typeof L;
  let mounted = $state(false);

  setContext('getMap', () => map!);

  function getMemberCountInPlace(place: Place): number {
    return members.filter(
      (m) => detectGeofences({ lat: m.lat, lng: m.lng }, [place]).length > 0,
    ).length;
  }

  onMount(async () => {
    leaflet = (await import('leaflet')).default;

    map = leaflet.map(mapContainer, {
      center: [center.lat, center.lng],
      zoom,
      zoomControl: true,
      attributionControl: true,
    });

    leaflet.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(map);

    // Fit bounds to show all members if we have any
    if (members.length > 0) {
      const bounds = leaflet.latLngBounds(
        members.map((m) => [m.lat, m.lng] as [number, number]),
      );
      map.fitBounds(bounds, { padding: [50, 50], maxZoom: 15 });
    }

    if (onMapRightClick) {
      map.on('contextmenu', (e: L.LeafletMouseEvent) => {
        onMapRightClick!(e.latlng.lat, e.latlng.lng);
      });
    }

    mounted = true;
  });

  export function flyTo(lat: number, lng: number, zoomLevel = 16): void {
    map?.flyTo([lat, lng], zoomLevel, { duration: 1 });
  }

  onDestroy(() => {
    if (map) {
      map.remove();
      map = null;
    }
  });
</script>

<div class="map-wrapper">
  <div class="map-container" bind:this={mapContainer}></div>

  {#if mounted && map}
    {#each members as member (member.memberId)}
      <MemberPin
        {member}
        dimmed={viewingHistoryMemberId !== null && member.memberId !== viewingHistoryMemberId}
        onclick={() => onMemberClick?.(member.memberId)}
      />
    {/each}

    {#each places as place (place.id)}
      <PlaceCircle {place} memberCount={getMemberCountInPlace(place)} />
    {/each}

    {#if historyTrail && historyTrail.length > 0}
      <HistoryTrail points={historyTrail} currentIndex={historyIndex} />
    {/if}
  {/if}
</div>

<style>
  .map-wrapper {
    position: relative;
    width: 100%;
    height: 100%;
  }

  .map-container {
    width: 100%;
    height: 100%;
  }

  :global(.member-pin) {
    background: transparent !important;
    border: none !important;
  }
</style>
