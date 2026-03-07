<script lang="ts">
  import type { Place, PlaceCreate, PlaceUpdate } from '$lib/api/types';

  let { place = null, onSave, onCancel }: {
    place?: Place | null;
    onSave: (p: PlaceCreate | PlaceUpdate) => void;
    onCancel: () => void;
  } = $props();

  let name = $state(place?.name ?? '');
  let icon = $state(place?.icon ?? '\u{1F4CD}');
  let radiusMeters = $state(place?.radiusMeters ?? 200);

  const ICONS = ['\u{1F3E0}', '\u{1F3EB}', '\u{1F3E2}', '\u{1F3AA}', '\u{26BD}', '\u{1F3D6}', '\u{1F6D2}', '\u{26EA}', '\u{1F3E5}', '\u{1F4CD}'];

  function handleSubmit() {
    if (!name.trim()) return;
    if (place) {
      const update: PlaceUpdate = {};
      if (name !== place.name) update.name = name;
      if (icon !== place.icon) update.icon = icon;
      if (radiusMeters !== place.radiusMeters) update.radiusMeters = radiusMeters;
      onSave(update);
    } else {
      onSave({ name, lat: 0, lng: 0, radiusMeters, icon } as PlaceCreate);
    }
  }
</script>

<div class="place-editor">
  <div class="editor-header">
    <h3>{place ? 'Edit Place' : 'New Place'}</h3>
    <button class="close-btn" onclick={onCancel}>&times;</button>
  </div>

  <form onsubmit={(e) => { e.preventDefault(); handleSubmit(); }}>
    <label class="field">
      <span class="field-label">Name</span>
      <input type="text" bind:value={name} placeholder="e.g. Home, School..." />
    </label>

    <div class="field">
      <span class="field-label">Icon</span>
      <div class="icon-grid">
        {#each ICONS as ic}
          <button
            type="button"
            class="icon-btn"
            class:selected={icon === ic}
            onclick={() => (icon = ic)}
          >{ic}</button>
        {/each}
      </div>
    </div>

    <label class="field">
      <span class="field-label">Radius: {radiusMeters}m</span>
      <input type="range" min="50" max="2000" step="50" bind:value={radiusMeters} />
    </label>

    {#if !place}
      <p class="hint">Click on the map to set the location</p>
    {/if}

    <div class="actions">
      <button type="button" class="btn-secondary" onclick={onCancel}>Cancel</button>
      <button type="submit" class="btn-primary" disabled={!name.trim()}>
        {place ? 'Update' : 'Create'}
      </button>
    </div>
  </form>
</div>

<style>
  .place-editor {
    background: #1a1a2e;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 16px;
    padding: 16px;
  }

  .editor-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 16px;
  }

  h3 {
    font-size: 1rem;
    font-weight: 600;
    color: #e0e0e0;
    margin: 0;
  }

  .close-btn {
    background: none;
    border: none;
    color: #8b8b9e;
    font-size: 1.5rem;
    cursor: pointer;
    padding: 0 4px;
    line-height: 1;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-bottom: 14px;
  }

  .field-label {
    font-size: 0.8rem;
    color: #8b8b9e;
    font-weight: 500;
  }

  input[type="text"] {
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 8px;
    padding: 8px 12px;
    color: #e0e0e0;
    font-size: 0.9rem;
  }

  input[type="text"]:focus {
    outline: none;
    border-color: #4a90e2;
  }

  input[type="range"] {
    width: 100%;
    accent-color: #4a90e2;
  }

  .icon-grid {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }

  .icon-btn {
    width: 36px;
    height: 36px;
    border-radius: 8px;
    border: 1px solid rgba(255, 255, 255, 0.08);
    background: rgba(255, 255, 255, 0.03);
    cursor: pointer;
    font-size: 1.2rem;
    transition: all 0.15s;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .icon-btn.selected {
    border-color: #4a90e2;
    background: rgba(74, 144, 226, 0.15);
  }

  .hint {
    font-size: 0.8rem;
    color: #6b6b7e;
    margin: 8px 0;
    font-style: italic;
  }

  .actions {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
    margin-top: 16px;
  }

  .btn-primary, .btn-secondary {
    padding: 8px 16px;
    border-radius: 8px;
    font-size: 0.85rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s;
    border: none;
  }

  .btn-primary {
    background: linear-gradient(135deg, #4a90e2, #357abd);
    color: white;
  }

  .btn-primary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn-secondary {
    background: rgba(255, 255, 255, 0.06);
    color: #8b8b9e;
    border: 1px solid rgba(255, 255, 255, 0.08);
  }
</style>
