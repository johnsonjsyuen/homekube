<script lang="ts">
    import WeatherTab from "./WeatherTab.svelte";
    import TtsTab from "./TtsTab.svelte";
    import SttTab from "./SttTab.svelte";
    import LiveTtsTab from "./LiveTtsTab.svelte";
    import { onMount } from "svelte";
    import { initKeycloak, login, logout, onAuthStateChange, type AuthState } from "$lib/auth";
    import { loadWeather, LOCATIONS, type WeatherData } from "$lib/weather";

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

    let activeTab = $state("weather");
    let currentLocation = $state("port_melbourne");
    let customLat = $state<string | undefined>(undefined);
    let customLon = $state<string | undefined>(undefined);
    let loading = $state(true);

    let data = $state<WeatherData>({
        location: "Port Melbourne, Australia",
        localTime: "",
        fetchedAt: null,
        temperature: null,
        condition: null,
        currentIcon: null,
        windSpeed: null,
        windDirection: null,
        windDirectionDesc: null,
        humidity: null,
        cloudCover: null,
        uvIndex: null,
        uvTime: null,
        forecast: null,
        dailyHourlyMap: null,
        timezone: null,
        error: null
    });

    async function refreshWeather() {
        loading = true;
        data = await loadWeather(currentLocation, customLat, customLon);
        loading = false;
    }

    onMount(() => {
        initKeycloak().then(() => {
            authInitialized = true;
        });

        const unsubscribe = onAuthStateChange((state) => {
            authState = state;
            if (authInitialized && !state.authenticated && activeTab !== "weather") {
                activeTab = "weather";
            }
        });

        return unsubscribe;
    });

    // Fetch weather on mount and refetch when location changes
    $effect(() => {
        const _loc = currentLocation;
        const _lat = customLat;
        const _lon = customLon;
        refreshWeather();
    });

    function selectTab(tab: string) {
        activeTab = tab;
        menuOpen = false;
    }

    let currentSelectValue = $derived.by(() => {
        if (customLat && customLon) return "current_location";
        return currentLocation;
    });

    function handleLocationChange(event: Event) {
        const select = event.target as HTMLSelectElement;
        const location = select.value;

        if (location === "current_location") {
            if (navigator.geolocation) {
                navigator.geolocation.getCurrentPosition(
                    (position) => {
                        const { latitude, longitude } = position.coords;
                        customLat = latitude.toString();
                        customLon = longitude.toString();
                    },
                    (error) => {
                        console.error("Error getting location:", error);
                        alert("Could not get your location. Please allow location access.");
                        select.value = currentSelectValue;
                    },
                );
            } else {
                alert("Geolocation is not supported by this browser.");
            }
        } else {
            customLat = undefined;
            customLon = undefined;
            currentLocation = location;
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
    };
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="container">
    <header class="header">
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
                        {#if authInitialized}
                            <div class="menu-auth">
                                {#if authState.authenticated}
                                    <span class="menu-username">{authState.username}</span>
                                    <button class="menu-auth-btn menu-logout-btn" onclick={() => { menuOpen = false; handleLogout(); }}>
                                        Log Out
                                    </button>
                                {:else}
                                    <button class="menu-auth-btn menu-login-btn" onclick={() => { menuOpen = false; handleLogin(); }}>
                                        Log In
                                    </button>
                                {/if}
                            </div>
                            <div class="menu-divider"></div>
                        {/if}
                        <button
                            class="menu-item {activeTab === 'weather' ? 'active' : ''}"
                            onclick={() => selectTab('weather')}
                        >
                            Weather
                        </button>
                        {#if authState.authenticated}
                            {#each Object.entries(tabLabels).filter(([key]) => key !== 'weather') as [key, label]}
                                <button
                                    class="menu-item {activeTab === key ? 'active' : ''}"
                                    onclick={() => selectTab(key)}
                                >
                                    {label}
                                </button>
                            {/each}
                        {/if}
                    </nav>
                {/if}
            </div>
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
        </div>
    </header>

    {#if activeTab === "weather"}
        {#if loading && !data.forecast}
            <div class="loading-msg">Loading weather data...</div>
        {:else}
            <WeatherTab {data} />
        {/if}
    {:else if authState.authenticated}
        {#if activeTab === "tts"}
            <TtsTab />
        {:else if activeTab === "stt"}
            <SttTab />
        {:else if activeTab === "live-tts"}
            <LiveTtsTab />
        {/if}
    {/if}
</div>

<style>
    .container {
        max-width: 900px;
        margin: 0 auto;
    }

    .header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 2rem;
        padding: 14px 20px;
        background: linear-gradient(145deg, rgba(255, 255, 255, 0.05) 0%, rgba(255, 255, 255, 0.02) 100%);
        backdrop-filter: blur(20px);
        border: 1px solid rgba(255, 255, 255, 0.06);
        border-radius: 16px;
        gap: 12px;
        position: relative;
        z-index: 20;
    }

    .header-left {
        display: flex;
        align-items: center;
        gap: 12px;
    }

    .header-right {
        display: flex;
        align-items: center;
        gap: 14px;
        flex-wrap: wrap;
        justify-content: flex-end;
    }

    .active-tab-label {
        font-size: 1.05rem;
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
        width: 38px;
        height: 38px;
        transition: all 0.2s;
    }

    .menu-btn:hover {
        background: rgba(255, 255, 255, 0.08);
        border-color: rgba(255, 255, 255, 0.18);
    }

    .menu-icon {
        display: flex;
        flex-direction: column;
        gap: 4px;
        width: 18px;
        transition: all 0.3s;
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
        top: calc(100% + 10px);
        left: 0;
        background: linear-gradient(160deg, #252538 0%, #1e1e30 100%);
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 14px;
        padding: 6px;
        min-width: 210px;
        z-index: 10;
        box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.03);
    }

    .menu-item {
        display: block;
        width: 100%;
        text-align: left;
        background: none;
        border: none;
        color: #8b8b9e;
        padding: 10px 14px;
        border-radius: 10px;
        cursor: pointer;
        font-size: 0.9rem;
        font-weight: 500;
        transition: all 0.15s;
        letter-spacing: 0.2px;
    }

    .menu-item:hover {
        background: rgba(255, 255, 255, 0.06);
        color: #e0e0e0;
    }

    .menu-item.active {
        background: linear-gradient(135deg, #4a90e2, #357abd);
        color: white;
    }

    .menu-auth {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 8px 14px;
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
        letter-spacing: 0.3px;
        white-space: nowrap;
    }

    .menu-login-btn {
        background: linear-gradient(135deg, #4a90e2, #357abd);
        color: white;
        width: 100%;
    }

    .menu-login-btn:hover {
        box-shadow: 0 2px 8px rgba(74, 144, 226, 0.3);
    }

    .menu-logout-btn {
        background: rgba(255, 255, 255, 0.06);
        color: #8b8b9e;
        border: 1px solid rgba(255, 255, 255, 0.08);
    }

    .menu-logout-btn:hover {
        background: rgba(255, 82, 82, 0.12);
        color: #ff6b6b;
        border-color: rgba(255, 82, 82, 0.2);
    }

    .menu-divider {
        height: 1px;
        background: rgba(255, 255, 255, 0.06);
        margin: 4px 10px;
    }

    .location-container {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-shrink: 0;
    }

    .location {
        font-size: 0.85rem;
        font-weight: 500;
        color: #8b8b9e;
        letter-spacing: 0.5px;
    }

    .location-select {
        background: rgba(255, 255, 255, 0.04);
        border: 1px solid rgba(255, 255, 255, 0.1);
        color: #b0b0c8;
        padding: 5px 10px;
        border-radius: 8px;
        font-size: 0.8rem;
        cursor: pointer;
        transition: all 0.2s;
    }

    .location-select:hover {
        border-color: rgba(255, 255, 255, 0.2);
        color: #e0e0e0;
    }

    .location-select option {
        background: #1e1e30;
        color: #e0e0e0;
    }

    .datetime-container {
        text-align: right;
        flex-shrink: 0;
        white-space: nowrap;
    }

    .datetime {
        font-size: 0.85rem;
        color: #6b6b7e;
    }

    .fetched-at {
        font-size: 0.7rem;
        color: #555;
        margin-top: 2px;
    }

    .loading-msg {
        text-align: center;
        color: #6b6b7e;
        padding: 40px;
        font-size: 1.1rem;
    }

    @media (max-width: 600px) {
        .header {
            flex-wrap: wrap;
            padding: 12px 14px;
        }
        .header-right {
            flex-wrap: wrap;
            gap: 8px;
        }
        .active-tab-label {
            font-size: 0.95rem;
        }
    }
</style>
