<script lang="ts">
  import type { MemberLocation } from '$lib/api/types';

  let { member, selected = false, onclick }: {
    member: MemberLocation;
    selected?: boolean;
    onclick: () => void;
  } = $props();

  function getStatusColor(m: MemberLocation): string {
    const age = Date.now() - new Date(m.timestamp).getTime();
    if (age < 5 * 60_000) return 'var(--status-online, #4caf50)';
    if (age < 30 * 60_000) return 'var(--status-stale, #ff9800)';
    return 'var(--status-offline, #757575)';
  }

  function getRelativeTime(timestamp: string): string {
    const ms = Date.now() - new Date(timestamp).getTime();
    if (ms < 60_000) return 'just now';
    if (ms < 3600_000) return `${Math.floor(ms / 60_000)}m ago`;
    if (ms < 86400_000) return `${Math.floor(ms / 3600_000)}h ago`;
    return `${Math.floor(ms / 86400_000)}d ago`;
  }

  function getBatteryIcon(battery: number | null): string {
    if (battery === null) return '';
    if (battery > 75) return '\u{1F50B}';
    if (battery > 25) return '\u{1FAAB}';
    return '\u{1FAB0}';
  }

  let avatarInitial = $derived(member.displayName.charAt(0).toUpperCase());
  let statusColor = $derived(getStatusColor(member));
</script>

<button class="member-card" class:selected onclick={onclick}>
  <div class="avatar" style="border-color: {statusColor}">
    {#if member.avatarUrl}
      <img src={member.avatarUrl} alt={member.displayName} />
    {:else}
      <span class="avatar-initial">{avatarInitial}</span>
    {/if}
    <span class="status-dot" style="background: {statusColor}"></span>
  </div>
  <div class="info">
    <div class="name">{member.displayName}</div>
    <div class="details">
      <span class="last-seen">{getRelativeTime(member.timestamp)}</span>
      {#if member.battery !== null}
        <span class="battery">{getBatteryIcon(member.battery)} {member.battery}%</span>
      {/if}
    </div>
  </div>
</button>

<style>
  .member-card {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 12px;
    border-radius: 12px;
    cursor: pointer;
    transition: background 0.2s;
    border: none;
    background: none;
    width: 100%;
    text-align: left;
    color: inherit;
  }

  .member-card:hover {
    background: rgba(255, 255, 255, 0.05);
  }

  .member-card.selected {
    background: rgba(74, 144, 226, 0.15);
  }

  .avatar {
    position: relative;
    width: 40px;
    height: 40px;
    border-radius: 50%;
    border: 2px solid;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(255, 255, 255, 0.08);
    flex-shrink: 0;
  }

  .avatar img {
    width: 100%;
    height: 100%;
    border-radius: 50%;
    object-fit: cover;
  }

  .avatar-initial {
    font-size: 1.1rem;
    font-weight: 600;
    color: #e0e0e0;
  }

  .status-dot {
    position: absolute;
    bottom: -1px;
    right: -1px;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    border: 2px solid #1a1a2e;
  }

  .info {
    flex: 1;
    min-width: 0;
  }

  .name {
    font-size: 0.9rem;
    font-weight: 500;
    color: #e0e0e0;
  }

  .details {
    display: flex;
    gap: 8px;
    font-size: 0.75rem;
    color: #6b6b7e;
    margin-top: 2px;
  }

  .battery {
    color: #8b8b9e;
  }
</style>
