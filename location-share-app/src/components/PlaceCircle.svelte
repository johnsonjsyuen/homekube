<script lang="ts">
  import type { Place } from '$lib/api/types';
  import { onMount, onDestroy, getContext } from 'svelte';
  import type L from 'leaflet';

  let { place, memberCount = 0 }: {
    place: Place;
    memberCount?: number;
  } = $props();

  const getMap = getContext<() => L.Map>('getMap');
  let circle: L.Circle | null = null;
  let leaflet: typeof L;

  onMount(async () => {
    leaflet = (await import('leaflet')).default;
    const map = getMap();

    circle = leaflet.circle([place.lat, place.lng], {
      radius: place.radiusMeters,
      color: '#4a90e2',
      fillColor: 'rgba(74,144,226,0.15)',
      fillOpacity: 0.4,
      weight: 2,
    })
      .addTo(map)
      .bindTooltip(`${place.icon} ${place.name}${memberCount > 0 ? ` (${memberCount})` : ''}`);
  });

  $effect(() => {
    if (!circle) return;
    const _lat = place.lat;
    const _lng = place.lng;
    const _r = place.radiusMeters;
    const _count = memberCount;
    circle.setLatLng([place.lat, place.lng]);
    circle.setRadius(place.radiusMeters);
    circle.setTooltipContent(`${place.icon} ${place.name}${memberCount > 0 ? ` (${memberCount})` : ''}`);
  });

  onDestroy(() => {
    if (circle) {
      circle.remove();
      circle = null;
    }
  });
</script>
