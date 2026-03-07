<script lang="ts">
  import SyncBadge from './SyncBadge.svelte';
  import type { SyncState } from '$lib/stores/sync.svelte';

  let { familyName, username, syncState, onLogout, onLogin }: {
    familyName: string;
    username: string | null;
    syncState: SyncState;
    onLogout: () => void;
    onLogin: () => void;
  } = $props();

  let menuOpen = $state(false);

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape' && menuOpen) {
      menuOpen = false;
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<header class="app-header">
  <div class="header-left">
    <div class="menu-wrapper">
      <button
        class="menu-btn"
        onclick={() => (menuOpen = !menuOpen)}
        aria-label="Menu"
        aria-expanded={menuOpen}
      >
        <span class="menu-icon" class:open={menuOpen}>
          <span></span>
          <span></span>
          <span></span>
        </span>
      </button>
      {#if menuOpen}
        <!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
        <div class="menu-backdrop" onclick={() => (menuOpen = false)}></div>
        <nav class="menu-dropdown">
          <div class="menu-auth">
            {#if username}
              <span class="menu-username">{username}</span>
              <button class="menu-auth-btn menu-logout-btn" onclick={() => { menuOpen = false; onLogout(); }}>
                Log Out
              </button>
            {:else}
              <button class="menu-auth-btn menu-login-btn" onclick={() => { menuOpen = false; onLogin(); }}>
                Log In
              </button>
            {/if}
          </div>
        </nav>
      {/if}
    </div>
    <span class="family-name">{familyName}</span>
  </div>

  <div class="header-right">
    <SyncBadge
      online={syncState.online}
      pendingCount={syncState.pendingCount}
      lastSyncTime={syncState.lastSyncTime}
    />
  </div>
</header>

<style>
  .app-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 10px 16px;
    background: linear-gradient(145deg, rgba(255, 255, 255, 0.05) 0%, rgba(255, 255, 255, 0.02) 100%);
    backdrop-filter: blur(20px);
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    z-index: 100;
    position: relative;
  }

  .header-left {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .header-right {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .family-name {
    font-size: 1rem;
    font-weight: 600;
    color: #e0e0e0;
    letter-spacing: 0.3px;
  }

  .menu-wrapper {
    position: relative;
  }

  .menu-btn {
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 10px;
    padding: 8px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    transition: all 0.2s;
  }

  .menu-btn:hover {
    background: rgba(255, 255, 255, 0.08);
  }

  .menu-icon {
    display: flex;
    flex-direction: column;
    gap: 4px;
    width: 16px;
  }

  .menu-icon span {
    display: block;
    height: 2px;
    width: 100%;
    background: #b0b0c8;
    border-radius: 1px;
    transition: all 0.3s;
    transform-origin: center;
  }

  .menu-icon.open span:nth-child(1) {
    transform: translateY(6px) rotate(45deg);
  }

  .menu-icon.open span:nth-child(2) {
    opacity: 0;
  }

  .menu-icon.open span:nth-child(3) {
    transform: translateY(-6px) rotate(-45deg);
  }

  .menu-backdrop {
    position: fixed;
    inset: 0;
    z-index: 9;
  }

  .menu-dropdown {
    position: absolute;
    top: calc(100% + 8px);
    left: 0;
    background: linear-gradient(160deg, #252538 0%, #1e1e30 100%);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 12px;
    padding: 8px;
    min-width: 200px;
    z-index: 10;
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5);
  }

  .menu-auth {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 10px;
    gap: 10px;
  }

  .menu-username {
    font-size: 0.85rem;
    color: #b0b0c8;
    font-weight: 500;
  }

  .menu-auth-btn {
    border: none;
    padding: 6px 14px;
    border-radius: 8px;
    cursor: pointer;
    font-size: 0.8rem;
    font-weight: 600;
    transition: all 0.2s;
  }

  .menu-login-btn {
    background: linear-gradient(135deg, #4a90e2, #357abd);
    color: white;
    width: 100%;
  }

  .menu-logout-btn {
    background: rgba(255, 255, 255, 0.06);
    color: #8b8b9e;
    border: 1px solid rgba(255, 255, 255, 0.08);
  }

  .menu-logout-btn:hover {
    background: rgba(255, 82, 82, 0.12);
    color: #ff6b6b;
  }
</style>
