<script lang="ts">
  import type { HistoryPoint } from '$lib/api/types';
  import { api } from '$lib/api/index';

  let { memberId, memberName, onClose, onHistoryLoaded }: {
    memberId: string;
    memberName: string;
    onClose: () => void;
    onHistoryLoaded: (points: HistoryPoint[], index: number) => void;
  } = $props();

  let selectedDate = $state(new Date().toISOString().split('T')[0]);
  let points = $state<HistoryPoint[]>([]);
  let scrubberIndex = $state(0);
  let playing = $state(false);
  let playTimer: ReturnType<typeof setInterval> | null = null;
  let loading = $state(false);

  async function loadHistoryData() {
    loading = true;
    try {
      points = await api.getLocationHistory({ memberId, date: selectedDate });
      scrubberIndex = points.length > 0 ? points.length - 1 : 0;
      onHistoryLoaded(points, scrubberIndex);
    } catch (e) {
      console.error('[History] Failed to load:', e);
      points = [];
    }
    loading = false;
  }

  $effect(() => {
    const _date = selectedDate;
    const _id = memberId;
    loadHistoryData();
  });

  $effect(() => {
    onHistoryLoaded(points, scrubberIndex);
  });

  function togglePlay() {
    if (playing) {
      stopPlay();
    } else {
      playing = true;
      if (scrubberIndex >= points.length - 1) scrubberIndex = 0;
      playTimer = setInterval(() => {
        if (scrubberIndex < points.length - 1) {
          scrubberIndex++;
        } else {
          stopPlay();
        }
      }, 100);
    }
  }

  function stopPlay() {
    playing = false;
    if (playTimer) {
      clearInterval(playTimer);
      playTimer = null;
    }
  }

  function formatTime(ts: string): string {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
</script>

<div class="history-panel">
  <div class="history-header">
    <div>
      <span class="history-title">History</span>
      <span class="history-member">{memberName}</span>
    </div>
    <button class="close-btn" onclick={onClose}>&times;</button>
  </div>

  <div class="history-controls">
    <input type="date" bind:value={selectedDate} class="date-picker" />
  </div>

  {#if loading}
    <div class="history-loading">Loading...</div>
  {:else if points.length === 0}
    <div class="history-empty">No history for this date</div>
  {:else}
    <div class="scrubber">
      <button class="play-btn" onclick={togglePlay}>
        {playing ? '\u{23F8}' : '\u{25B6}'}
      </button>
      <input
        type="range"
        min="0"
        max={points.length - 1}
        bind:value={scrubberIndex}
        class="scrubber-slider"
      />
      <span class="scrubber-time">
        {formatTime(points[scrubberIndex].timestamp)}
      </span>
    </div>
    <div class="point-info">
      <span>{points.length} points</span>
      {#if points[scrubberIndex].speed !== null}
        <span>{(points[scrubberIndex].speed! * 3.6).toFixed(1)} km/h</span>
      {/if}
    </div>
  {/if}
</div>

<style>
  .history-panel {
    padding: 12px;
  }

  .history-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 12px;
  }

  .history-title {
    font-size: 0.8rem;
    font-weight: 600;
    color: #8b8b9e;
    text-transform: uppercase;
    letter-spacing: 1px;
  }

  .history-member {
    font-size: 0.85rem;
    color: #4a90e2;
    margin-left: 8px;
    font-weight: 500;
  }

  .close-btn {
    background: none;
    border: none;
    color: #8b8b9e;
    font-size: 1.3rem;
    cursor: pointer;
    padding: 0 4px;
    line-height: 1;
  }

  .history-controls {
    margin-bottom: 12px;
  }

  .date-picker {
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 8px;
    padding: 6px 10px;
    color: #e0e0e0;
    font-size: 0.85rem;
    width: 100%;
    color-scheme: dark;
  }

  .scrubber {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .play-btn {
    background: rgba(74, 144, 226, 0.15);
    border: none;
    color: #4a90e2;
    width: 32px;
    height: 32px;
    border-radius: 50%;
    cursor: pointer;
    font-size: 0.9rem;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .scrubber-slider {
    flex: 1;
    accent-color: #4a90e2;
  }

  .scrubber-time {
    font-size: 0.75rem;
    color: #8b8b9e;
    min-width: 50px;
    text-align: right;
  }

  .point-info {
    display: flex;
    justify-content: space-between;
    font-size: 0.75rem;
    color: #6b6b7e;
    margin-top: 6px;
    padding: 0 4px;
  }

  .history-loading, .history-empty {
    text-align: center;
    color: #6b6b7e;
    font-size: 0.85rem;
    padding: 16px;
  }
</style>
