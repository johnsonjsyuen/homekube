<script lang="ts">
    import { onMount, onDestroy } from 'svelte';
    import { initKeycloak, login, logout, onAuthStateChange, type AuthState } from '$lib/auth';
    import { initDatabase } from '$lib/db/index';
    import { SyncService } from '$lib/api/sync';
    import { GpsTracker } from '$lib/geo/tracker';
    import { getMemberLocations } from '$lib/stores/members.svelte';
    import { getPlacesList } from '$lib/stores/places.svelte';
    import { getSyncState } from '$lib/stores/sync.svelte';
    import { config } from '$lib/config';
    import type { HistoryPoint, PlaceCreate, PlaceUpdate } from '$lib/api/types';
    import { api } from '$lib/api/index';
    import Header from '../components/Header.svelte';
    import MapComponent from '../components/Map.svelte';
    import MemberList from '../components/MemberList.svelte';
    import PlaceList from '../components/PlaceList.svelte';
    import PlaceEditor from '../components/PlaceEditor.svelte';
    import HistoryPanel from '../components/HistoryPanel.svelte';

    let authState = $state<AuthState>({
        authenticated: false,
        token: null,
        username: null,
        roles: [],
    });
    let authInitialized = $state(false);
    let authError = $state('');
    let dbReady = $state(false);

    let syncService: SyncService | null = null;
    let gpsTracker: GpsTracker | null = null;
    let selectedMemberId = $state<string | null>(null);
    let historyPoints = $state<HistoryPoint[]>([]);
    let historyIndex = $state(0);
    let viewingHistory = $state(false);
    let sidebarTab = $state<'members' | 'places'>('members');
    let showPlaceEditor = $state(false);
    let editingPlaceId = $state<string | null>(null);
    let newPlaceCoords = $state<{ lat: number; lng: number } | null>(null);
    let mapRef: MapComponent;

    let members = $derived(getMemberLocations());
    let places = $derived(getPlacesList());
    let syncState = $derived(getSyncState());

    let selectedMemberName = $derived.by(() => {
        if (!selectedMemberId) return '';
        return members.find((m) => m.memberId === selectedMemberId)?.displayName ?? '';
    });

    onMount(() => {
        // Init DB, then start GPS tracker
        initDatabase()
            .then(() => {
                dbReady = true;
                // Start GPS tracking with a default self member ID
                // In production, this would come from Keycloak auth subject ID
                gpsTracker = new GpsTracker('member-dad');
                gpsTracker.start().catch((e) => console.warn('[App] GPS start failed:', e));
            })
            .catch((e) => { console.error('[App] DB init failed:', e); });

        // Init auth
        initKeycloak()
            .then(() => { authInitialized = true; })
            .catch((e) => {
                authInitialized = true;
                authError = `Auth init failed: ${e?.message || e}`;
            });

        const unsubscribe = onAuthStateChange((state) => {
            authState = state;
        });

        // Start sync service
        syncService = new SyncService();
        syncService.start();

        return () => {
            unsubscribe();
            syncService?.stop();
            gpsTracker?.stop();
        };
    });

    function handleMemberSelect(id: string) {
        selectedMemberId = id;
        const member = members.find((m) => m.memberId === id);
        if (member) {
            mapRef?.flyTo(member.lat, member.lng);
        }
    }

    function handleMemberMapClick(id: string) {
        selectedMemberId = id;
        // Scroll sidebar to member (handled by selection state)
    }

    function handleHistoryLoaded(points: HistoryPoint[], index: number) {
        historyPoints = points;
        historyIndex = index;
        viewingHistory = points.length > 0;
    }

    function handleCloseHistory() {
        viewingHistory = false;
        historyPoints = [];
        historyIndex = 0;
        selectedMemberId = null;
    }

    function handleMapRightClick(lat: number, lng: number) {
        newPlaceCoords = { lat, lng };
        showPlaceEditor = true;
        editingPlaceId = null;
        sidebarTab = 'places';
    }

    async function handlePlaceSave(data: PlaceCreate | PlaceUpdate) {
        try {
            if (editingPlaceId) {
                await api.updatePlace(editingPlaceId, data);
            } else {
                const createData = data as PlaceCreate;
                const placeData = newPlaceCoords
                    ? { ...createData, lat: newPlaceCoords.lat, lng: newPlaceCoords.lng }
                    : createData;
                await api.createPlace(placeData);
            }
            // Re-pull to refresh
            await syncService?.pullFamily();
        } catch (e) {
            console.error('[App] Place save failed:', e);
        }
        showPlaceEditor = false;
        editingPlaceId = null;
        newPlaceCoords = null;
    }

    function handlePlaceEdit(id: string) {
        editingPlaceId = id;
        showPlaceEditor = true;
    }

    async function handlePlaceDelete(id: string) {
        try {
            await api.deletePlace(id);
            await syncService?.pullFamily();
        } catch (e) {
            console.error('[App] Place delete failed:', e);
        }
    }

    async function handleLogin() {
        try {
            authError = '';
            await login();
        } catch (e: any) {
            authError = e?.message || String(e);
        }
    }

    async function handleLogout() {
        await logout();
    }
</script>

<div class="app-shell">
    <Header
        familyName="Family Locator"
        username={authState.username}
        {syncState}
        onLogout={handleLogout}
        onLogin={handleLogin}
    />

    {#if authError}
        <div class="auth-error">
            <span>{authError}</span>
            <button onclick={() => (authError = '')}>dismiss</button>
        </div>
    {/if}

    <div class="main-content">
        <aside class="sidebar">
            <div class="sidebar-tabs">
                <button
                    class="sidebar-tab"
                    class:active={sidebarTab === 'members'}
                    onclick={() => (sidebarTab = 'members')}
                >
                    Members
                </button>
                <button
                    class="sidebar-tab"
                    class:active={sidebarTab === 'places'}
                    onclick={() => (sidebarTab = 'places')}
                >
                    Places
                </button>
            </div>

            <div class="sidebar-content">
                {#if sidebarTab === 'members'}
                    <MemberList
                        {members}
                        selectedId={selectedMemberId}
                        onSelect={handleMemberSelect}
                    />

                    {#if selectedMemberId && !viewingHistory}
                        <div class="sidebar-divider"></div>
                        <HistoryPanel
                            memberId={selectedMemberId}
                            memberName={selectedMemberName}
                            onClose={handleCloseHistory}
                            onHistoryLoaded={handleHistoryLoaded}
                        />
                    {/if}

                    {#if viewingHistory}
                        <div class="sidebar-divider"></div>
                        <div class="history-active">
                            <button class="exit-history-btn" onclick={handleCloseHistory}>
                                Exit History View
                            </button>
                        </div>
                    {/if}
                {:else}
                    <PlaceList
                        {places}
                        {members}
                        onEdit={handlePlaceEdit}
                        onDelete={handlePlaceDelete}
                    />
                    <div class="add-place-wrapper">
                        {#if showPlaceEditor}
                            <PlaceEditor
                                place={editingPlaceId ? places.find((p) => p.id === editingPlaceId) : null}
                                onSave={handlePlaceSave}
                                onCancel={() => { showPlaceEditor = false; editingPlaceId = null; newPlaceCoords = null; }}
                            />
                        {:else}
                            <button class="add-place-btn" onclick={() => { showPlaceEditor = true; editingPlaceId = null; }}>
                                + Add Place
                            </button>
                            <p class="add-place-hint">or right-click on the map</p>
                        {/if}
                    </div>
                {/if}
            </div>
        </aside>

        <div class="map-area">
            <MapComponent
                bind:this={mapRef}
                {members}
                {places}
                historyTrail={viewingHistory ? historyPoints : null}
                {historyIndex}
                center={config.location.defaultCenter}
                viewingHistoryMemberId={viewingHistory ? selectedMemberId : null}
                onMemberClick={handleMemberMapClick}
                onMapRightClick={handleMapRightClick}
            />
        </div>
    </div>
</div>

<style>
    .app-shell {
        display: flex;
        flex-direction: column;
        height: 100vh;
        width: 100%;
        overflow: hidden;
    }

    .auth-error {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 12px;
        padding: 8px 16px;
        background: rgba(248, 113, 113, 0.1);
        border-bottom: 1px solid rgba(248, 113, 113, 0.3);
        color: #f87171;
        font-size: 0.85rem;
    }

    .auth-error button {
        background: none;
        border: 1px solid rgba(248, 113, 113, 0.3);
        color: #f87171;
        padding: 2px 10px;
        border-radius: 6px;
        cursor: pointer;
        font-size: 0.8rem;
        flex-shrink: 0;
    }

    .main-content {
        display: flex;
        flex: 1;
        overflow: hidden;
    }

    .sidebar {
        width: 320px;
        background: linear-gradient(180deg, rgba(255, 255, 255, 0.03) 0%, rgba(255, 255, 255, 0.01) 100%);
        border-right: 1px solid rgba(255, 255, 255, 0.06);
        display: flex;
        flex-direction: column;
        overflow: hidden;
        flex-shrink: 0;
    }

    .sidebar-tabs {
        display: flex;
        border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    }

    .sidebar-tab {
        flex: 1;
        padding: 10px;
        background: none;
        border: none;
        color: #6b6b7e;
        font-size: 0.85rem;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.15s;
        border-bottom: 2px solid transparent;
    }

    .sidebar-tab:hover {
        color: #8b8b9e;
    }

    .sidebar-tab.active {
        color: #4a90e2;
        border-bottom-color: #4a90e2;
    }

    .sidebar-content {
        flex: 1;
        overflow-y: auto;
        scrollbar-width: thin;
        scrollbar-color: rgba(255, 255, 255, 0.1) transparent;
    }

    .sidebar-divider {
        height: 1px;
        background: rgba(255, 255, 255, 0.06);
        margin: 4px 12px;
    }

    .map-area {
        flex: 1;
        position: relative;
    }

    .add-place-wrapper {
        padding: 12px;
    }

    .add-place-btn {
        width: 100%;
        padding: 10px;
        background: rgba(74, 144, 226, 0.1);
        border: 1px dashed rgba(74, 144, 226, 0.3);
        border-radius: 10px;
        color: #4a90e2;
        font-size: 0.85rem;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.2s;
    }

    .add-place-btn:hover {
        background: rgba(74, 144, 226, 0.2);
    }

    .add-place-hint {
        text-align: center;
        font-size: 0.75rem;
        color: #6b6b7e;
        margin-top: 6px;
    }

    .history-active {
        padding: 12px;
    }

    .exit-history-btn {
        width: 100%;
        padding: 8px;
        background: rgba(255, 152, 0, 0.1);
        border: 1px solid rgba(255, 152, 0, 0.3);
        border-radius: 8px;
        color: #ff9800;
        font-size: 0.85rem;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.15s;
    }

    .exit-history-btn:hover {
        background: rgba(255, 152, 0, 0.2);
    }

    /* Mobile: bottom sheet instead of sidebar */
    @media (max-width: 768px) {
        .main-content {
            flex-direction: column-reverse;
        }

        .sidebar {
            width: 100%;
            max-height: 40vh;
            border-right: none;
            border-top: 1px solid rgba(255, 255, 255, 0.06);
        }

        .map-area {
            flex: 1;
        }
    }
</style>
