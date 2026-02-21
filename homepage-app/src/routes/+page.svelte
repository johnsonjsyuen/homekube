<script lang="ts">
    import WeatherTab from "./WeatherTab.svelte";
    import TtsTab from "./TtsTab.svelte";
    import SttTab from "./SttTab.svelte";
    import LiveTtsTab from "./LiveTtsTab.svelte";
    import { onMount } from "svelte";
    import { initKeycloak } from "$lib/auth";
    import { loadWeather, LOCATIONS, type WeatherData } from "$lib/weather";

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
        error: null
    });

    async function refreshWeather() {
        loading = true;
        data = await loadWeather(currentLocation, customLat, customLon);
        loading = false;
    }

    onMount(() => {
        initKeycloak();
    });

    // Fetch weather on mount and refetch when location changes
    $effect(() => {
        // Track dependencies
        const _loc = currentLocation;
        const _lat = customLat;
        const _lon = customLon;
        refreshWeather();
    });

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
                        // Reset select to current value
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
</script>

<div class="container">
    <header class="header">
        <div class="tabs">
            <button
                class="tab-btn {activeTab === 'weather' ? 'active' : ''}"
                onclick={() => (activeTab = "weather")}
            >
                Weather
            </button>
            <button
                class="tab-btn {activeTab === 'tts' ? 'active' : ''}"
                onclick={() => (activeTab = "tts")}
            >
                Text to Speech
            </button>
            <button
                class="tab-btn {activeTab === 'stt' ? 'active' : ''}"
                onclick={() => (activeTab = "stt")}
            >
                Speech to Text
            </button>
            <button
                class="tab-btn {activeTab === 'live-tts' ? 'active' : ''}"
                onclick={() => (activeTab = "live-tts")}
            >
                Live TTS
            </button>
        </div>

        {#if activeTab === "weather"}
            <div class="location-container">
                <div class="location">📍 {data.location}</div>
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
    </header>

    {#if activeTab === "weather"}
        {#if loading && !data.forecast}
            <div class="loading-msg">Loading weather data...</div>
        {:else}
            <WeatherTab {data} />
        {/if}
    {:else if activeTab === "tts"}
        <TtsTab />
    {:else if activeTab === "stt"}
        <SttTab />
    {:else if activeTab === "live-tts"}
        <LiveTtsTab />
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
        flex-wrap: wrap;
        gap: 15px;
    }

    .tabs {
        display: flex;
        gap: 10px;
    }

    .tab-btn {
        background: #333;
        border: none;
        color: #aaa;
        padding: 10px 20px;
        border-radius: 20px;
        cursor: pointer;
        font-weight: 600;
        transition: all 0.2s;
    }

    .tab-btn.active {
        background: #4a90e2;
        color: white;
    }

    .location-container {
        display: flex;
        align-items: center;
        gap: 10px;
    }

    .location {
        font-size: 1.2rem;
        font-weight: 600;
    }

    .location-select {
        background: #333;
        color: #fff;
        border: 1px solid #444;
        padding: 5px 10px;
        border-radius: 5px;
        font-size: 0.9rem;
    }

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

    .loading-msg {
        text-align: center;
        color: #888;
        padding: 40px;
        font-size: 1.1rem;
    }
</style>
