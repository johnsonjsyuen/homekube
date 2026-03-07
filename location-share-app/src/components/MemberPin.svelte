<script lang="ts">
  import type { MemberLocation } from '$lib/api/types';
  import { onMount, onDestroy, getContext } from 'svelte';
  import type L from 'leaflet';

  let { member, dimmed = false, onclick }: {
    member: MemberLocation;
    dimmed?: boolean;
    onclick?: () => void;
  } = $props();

  const getMap = getContext<() => L.Map>('getMap');
  let marker: L.Marker | null = null;
  let leaflet: typeof L;

  function getStatusColor(): string {
    const age = Date.now() - new Date(member.timestamp).getTime();
    if (age < 5 * 60_000) return '#4caf50';
    if (age < 30 * 60_000) return '#ff9800';
    return '#757575';
  }

  function createIcon(): L.DivIcon {
    const color = getStatusColor();
    const initial = member.displayName.charAt(0).toUpperCase();
    const opacity = dimmed ? '0.4' : '1';
    return leaflet.divIcon({
      className: 'member-pin',
      html: `<div style="
        width: 36px; height: 36px; border-radius: 50%;
        background: #1a1a2e; border: 3px solid ${color};
        display: flex; align-items: center; justify-content: center;
        font-weight: 600; font-size: 14px; color: #e0e0e0;
        box-shadow: 0 2px 8px rgba(0,0,0,0.3);
        opacity: ${opacity};
      ">${initial}</div>`,
      iconSize: [36, 36],
      iconAnchor: [18, 18],
    });
  }

  function getPopupContent(): string {
    const lastSeen = new Date(member.timestamp).toLocaleTimeString();
    const battery = member.battery !== null ? `${member.battery}%` : 'N/A';
    const speed = member.speed !== null ? `${(member.speed * 3.6).toFixed(1)} km/h` : 'N/A';
    return `
      <div style="font-family: Inter, sans-serif; min-width: 120px;">
        <strong>${member.displayName}</strong><br/>
        <span style="color: #666; font-size: 12px;">
          Last seen: ${lastSeen}<br/>
          Battery: ${battery}<br/>
          Speed: ${speed}
        </span>
      </div>
    `;
  }

  onMount(async () => {
    leaflet = (await import('leaflet')).default;
    const map = getMap();

    marker = leaflet.marker([member.lat, member.lng], { icon: createIcon() })
      .addTo(map)
      .bindPopup(getPopupContent());

    if (onclick) {
      marker.on('click', onclick);
    }
  });

  $effect(() => {
    if (!marker || !leaflet) return;
    // Reactively update position and icon
    const _lat = member.lat;
    const _lng = member.lng;
    const _ts = member.timestamp;
    const _dim = dimmed;
    marker.setLatLng([member.lat, member.lng]);
    marker.setIcon(createIcon());
    marker.setPopupContent(getPopupContent());
  });

  onDestroy(() => {
    if (marker) {
      marker.remove();
      marker = null;
    }
  });
</script>
