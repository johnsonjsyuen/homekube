<script lang="ts">
    import { goto } from "$app/navigation";
    import { page } from "$app/state";
    import type { PageData } from "./$types";
    import WeatherTab from "./WeatherTab.svelte";
    import TtsTab from "./TtsTab.svelte";
    import SttTab from "./SttTab.svelte";
    import LiveTtsTab from "./LiveTtsTab.svelte";
    import WhatsAppTab from "./WhatsAppTab.svelte";
    import WorkflowsTab from "./WorkflowsTab.svelte";
    import ScraperTab from "./ScraperTab.svelte";
    import { onMount } from "svelte";
    import { initKeycloak, login, logout, onAuthStateChange, type AuthState } from "$lib/auth";

    let { data } = $props();

    // Track hydration state for testing (event handlers only work after hydration)
    let hydrated = $state(false);

    // Centralized auth state
    let authState = $state<AuthState>({
        authenticated: false,
        token: null,
        username: null,
        roles: [],
    });
    let authInitialized = $state(false);

    // Menu state
    let menuOpen = $state(false);

    onMount(() => {
        hydrated = true;
        initKeycloak().then(() => {
            authInitialized = true;
        });
        const unsubscribe = onAuthStateChange((state) => {
            authState = state;
            // If user logs out after auth is initialized, go back to weather
            if (authInitialized && !state.authenticated && activeTab !== "weather") {
                activeTab = "weather";
            }
        });
        return unsubscribe;
    });

    // Initialize active tab from URL query parameter
    let activeTab = $state(page.url.searchParams.get("tab") || "weather");

    function selectTab(tab: string) {
        activeTab = tab;
        menuOpen = false;
        const url = new URL(page.url);
        url.searchParams.set("tab", tab);
        goto(url, { replaceState: true });
    }

    let currentSelectValue = $derived.by(() => {
        const lat = page.url.searchParams.get("lat");
        const lon = page.url.searchParams.get("lon");
        if (lat && lon) return "current_location";
        return page.url.searchParams.get("location") || "port_melbourne";
    });

    function handleLocationChange(event: Event) {
        const select = event.target as HTMLSelectElement;
        const location = select.value;

        if (location === "current_location") {
            if (navigator.geolocation) {
                navigator.geolocation.getCurrentPosition(
                    (position) => {
                        const { latitude, longitude } = position.coords;
                        const url = new URL(page.url);
                        url.searchParams.delete("location");
                        url.searchParams.set("lat", latitude.toString());
                        url.searchParams.set("lon", longitude.toString());
                        goto(url);
                    },
                    (error) => {
                        console.error("Error getting location:", error);
                        alert(
                            "Could not get your location. Please allow location access.",
                        );
                        select.value =
                            page.url.searchParams.get("location") ||
                            "port_melbourne";
                    },
                );
            } else {
                alert("Geolocation is not supported by this browser.");
            }
        } else {
            const url = new URL(page.url);
            url.searchParams.delete("lat");
            url.searchParams.delete("lon");
            url.searchParams.set("location", location);
            goto(url);
        }
    }

    async function handleLogin() {
        await login();
    }

    async function handleLogout() {
        await logout();
    }

    function handleKeydown(event: KeyboardEvent) {
        if (event.key === "Escape" && menuOpen) {
            menuOpen = false;
        }
    }

    const tabLabels: Record<string, string> = {
        weather: "Weather",
        tts: "Text to Speech",
        stt: "Speech to Text",
        "live-tts": "Live TTS",
        whatsapp: "WhatsApp",
        workflows: "Workflows",
        scraper: "Scraper",
    };
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="container" data-hydrated={hydrated ? '' : undefined}>
    <header class="header">
        <div class="header-left">
            {#if authState.authenticated}
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
                            {#each Object.entries(tabLabels) as [key, label]}
                                <button
                                    class="menu-item {activeTab === key ? 'active' : ''}"
                                    onclick={() => selectTab(key)}
                                >
                                    {label}
                                </button>
                            {/each}
                        </nav>
                    {/if}
                </div>
            {/if}
            <span class="active-tab-label">{tabLabels[activeTab]}</span>
        </div>

        <div class="header-right">
            {#if activeTab === "weather"}
                <div class="location-container">
                    <div class="location">{data.location}</div>
                    <select
                        class="location-select"
                        onchange={handleLocationChange}
                        value={currentSelectValue}
                    >
                        <option value="port_melbourne">Port Melbourne</option>
                        <option value="sydney">Sydney</option>
                        <option value="hong_kong">Hong Kong</option>
                        <option value="current_location">Current Location</option>
                    </select>
                </div>
            {/if}
            <div class="datetime-container">
                <div class="datetime">{data.localTime}</div>
                {#if data.fetchedAt}
                    <div class="fetched-at">
                        Last updated: {new Date(data.fetchedAt).toLocaleTimeString()}
                    </div>
                {/if}
            </div>
            {#if authInitialized}
                {#if authState.authenticated}
                    <div class="auth-info">
                        <span class="username">{authState.username}</span>
                        <button class="auth-btn logout-btn" onclick={handleLogout}>Log Out</button>
                    </div>
                {:else}
                    <button class="auth-btn login-btn" onclick={handleLogin}>Log In</button>
                {/if}
            {/if}
        </div>
    </header>

    {#if activeTab === "weather"}
        <WeatherTab {data} />
    {:else if authState.authenticated}
        {#if activeTab === "tts"}
            <TtsTab />
        {:else if activeTab === "stt"}
            <SttTab />
        {:else if activeTab === "live-tts"}
            <LiveTtsTab />
        {:else if activeTab === "whatsapp"}
            <WhatsAppTab />
        {:else if activeTab === "workflows"}
            <WorkflowsTab />
        {:else if activeTab === "scraper"}
            <ScraperTab />
        {/if}
    {/if}
</div>

<style>
    :global(body) {
        margin: 0;
        font-family: "Inter", sans-serif;
        background-color: #1a1a1a;
        color: #e0e0e0;
    }

    .container {
        max-width: 800px;
        margin: 0 auto;
        padding: 20px;
    }

    .header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 30px;
        gap: 15px;
    }

    .header-left {
        display: flex;
        align-items: center;
        gap: 12px;
    }

    .header-right {
        display: flex;
        align-items: center;
        gap: 15px;
    }

    .active-tab-label {
        font-size: 1.1rem;
        font-weight: 600;
        color: #e0e0e0;
    }

    /* Hamburger menu button */
    .menu-wrapper {
        position: relative;
    }

    .menu-btn {
        background: none;
        border: 1px solid rgba(255, 255, 255, 0.15);
        border-radius: 8px;
        padding: 8px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        width: 40px;
        height: 40px;
        transition: background 0.2s;
    }

    .menu-btn:hover {
        background: rgba(255, 255, 255, 0.08);
    }

    .menu-icon {
        display: flex;
        flex-direction: column;
        gap: 4px;
        width: 20px;
        transition: all 0.3s;
    }

    .menu-icon span {
        display: block;
        height: 2px;
        width: 100%;
        background: #e0e0e0;
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

    /* Dropdown menu */
    .menu-backdrop {
        position: fixed;
        inset: 0;
        z-index: 9;
    }

    .menu-dropdown {
        position: absolute;
        top: calc(100% + 8px);
        left: 0;
        background: #2a2a2a;
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 12px;
        padding: 6px;
        min-width: 200px;
        z-index: 10;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
    }

    .menu-item {
        display: block;
        width: 100%;
        text-align: left;
        background: none;
        border: none;
        color: #aaa;
        padding: 10px 14px;
        border-radius: 8px;
        cursor: pointer;
        font-size: 0.95rem;
        font-weight: 500;
        transition: all 0.15s;
    }

    .menu-item:hover {
        background: rgba(255, 255, 255, 0.06);
        color: #fff;
    }

    .menu-item.active {
        background: #4a90e2;
        color: white;
    }

    /* Location */
    .location-container {
        display: flex;
        align-items: center;
        gap: 8px;
    }

    .location {
        font-size: 0.95rem;
        font-weight: 500;
        color: #8b8b9e;
    }

    .location-select {
        background: #333;
        color: #fff;
        border: 1px solid #444;
        padding: 5px 10px;
        border-radius: 5px;
        font-size: 0.85rem;
    }

    /* Datetime */
    .datetime-container {
        text-align: right;
    }

    .datetime {
        font-size: 0.9rem;
        color: #888;
    }

    .fetched-at {
        font-size: 0.75rem;
        color: #666;
        margin-top: 2px;
    }

    /* Auth buttons */
    .auth-info {
        display: flex;
        align-items: center;
        gap: 10px;
    }

    .username {
        font-size: 0.85rem;
        color: #8b8b9e;
    }

    .auth-btn {
        border: none;
        padding: 8px 16px;
        border-radius: 8px;
        cursor: pointer;
        font-size: 0.85rem;
        font-weight: 600;
        transition: all 0.2s;
    }

    .login-btn {
        background: #4a90e2;
        color: white;
    }

    .login-btn:hover {
        background: #357abd;
    }

    .logout-btn {
        background: rgba(255, 255, 255, 0.08);
        color: #aaa;
    }

    .logout-btn:hover {
        background: rgba(255, 82, 82, 0.15);
        color: #ff5252;
    }

    @media (max-width: 600px) {
        .header {
            flex-wrap: wrap;
        }
        .header-right {
            flex-wrap: wrap;
            gap: 10px;
        }
    }
</style>
