<script lang="ts">
  import type { HistoryPoint } from '$lib/api/types';
  import { onMount, onDestroy, getContext } from 'svelte';
  import type L from 'leaflet';

  let { points, currentIndex = 0 }: {
    points: HistoryPoint[];
    currentIndex?: number;
  } = $props();

  const getMap = getContext<() => L.Map>('getMap');
  let polyline: L.Polyline | null = null;
  let currentMarker: L.CircleMarker | null = null;
  let leaflet: typeof L;

  onMount(async () => {
    leaflet = (await import('leaflet')).default;
    updateTrail();
  });

  function updateTrail() {
    if (!leaflet) return;
    const map = getMap();

    // Remove old layers
    if (polyline) polyline.remove();
    if (currentMarker) currentMarker.remove();

    if (points.length === 0) return;

    const latlngs = points.map((p) => [p.lat, p.lng] as [number, number]);

    polyline = leaflet.polyline(latlngs, {
      color: '#4a90e2',
      weight: 3,
      opacity: 0.7,
    }).addTo(map);

    const current = points[currentIndex];
    if (current) {
      currentMarker = leaflet.circleMarker([current.lat, current.lng], {
        radius: 8,
        color: '#4a90e2',
        fillColor: '#fff',
        fillOpacity: 1,
        weight: 3,
      }).addTo(map);
    }
  }

  $effect(() => {
    const _pts = points;
    const _idx = currentIndex;
    updateTrail();
  });

  onDestroy(() => {
    if (polyline) polyline.remove();
    if (currentMarker) currentMarker.remove();
  });
</script>
