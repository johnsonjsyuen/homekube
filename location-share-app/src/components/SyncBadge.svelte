<script lang="ts">
  let { online, pendingCount, lastSyncTime }: {
    online: boolean;
    pendingCount: number;
    lastSyncTime: string | null;
  } = $props();

  let tooltipText = $derived.by(() => {
    if (lastSyncTime) {
      return `Last sync: ${new Date(lastSyncTime).toLocaleTimeString()}`;
    }
    return 'Not synced yet';
  });
</script>

<div class="sync-badge" title={tooltipText}>
  <span class="sync-dot" class:online class:offline={!online}></span>
  {#if pendingCount > 0}
    <span class="sync-count">{pendingCount}</span>
  {/if}
</div>

<style>
  .sync-badge {
    display: flex;
    align-items: center;
    gap: 6px;
    cursor: default;
  }

  .sync-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
  }

  .sync-dot.online {
    background: #4caf50;
    box-shadow: 0 0 6px rgba(76, 175, 80, 0.5);
  }

  .sync-dot.offline {
    background: #757575;
  }

  .sync-count {
    font-size: 0.7rem;
    background: rgba(255, 152, 0, 0.2);
    color: #ff9800;
    padding: 1px 6px;
    border-radius: 10px;
    font-weight: 600;
  }
</style>
