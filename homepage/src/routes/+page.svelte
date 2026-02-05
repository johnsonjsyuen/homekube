<script lang="ts">
    import { goto } from "$app/navigation";
    import { page } from "$app/state";
    import { onMount } from "svelte";
    import {
        initKeycloak,
        login,
        logout,
        onAuthStateChange,
        type AuthState,
    } from "$lib/auth";
    import type { PageData } from "./$types";
    import WeatherTab from "./WeatherTab.svelte";
    // import SpeedtestTab from "./SpeedtestTab.svelte";
    import TtsTab from "./TtsTab.svelte";

    let { data } = $props();

    // Initialize active tab from URL query parameter
    let activeTab = $state(page.url.searchParams.get("tab") || "weather");

    // Auth state
    let authState = $state<AuthState>({
        authenticated: false,
        token: null,
        username: null,
        roles: [],
    });
    let authInitialized = $state(false);

    onMount(() => {
        // Initialize Keycloak and subscribe to auth state changes
        initKeycloak().then(() => {
            authInitialized = true;
        });

        const unsubscribe = onAuthStateChange((state) => {
            authState = state;
        });

        return unsubscribe;
    });

    async function handleLogin() {
        await login();
    }

    async function handleLogout() {
        await logout();
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
        <div class="right-section">
            <div class="datetime-container">
                <div class="datetime">{data.localTime}</div>
                {#if data.fetchedAt}
                    <div class="fetched-at">
                        Last updated: {new Date(
                            data.fetchedAt,
                        ).toLocaleTimeString()}
                    </div>
                {/if}
            </div>

            <div class="auth-container">
                {#if !authInitialized}
                    <span class="auth-loading">Loading...</span>
                {:else if !authState.authenticated}
                    <button class="login-btn-header" onclick={handleLogin}
                        >Log In</button
                    >
                {:else}
                    <div class="user-info-header">
                        <span class="username">{authState.username}</span>
                        <button class="logout-btn-header" onclick={handleLogout}
                            >Log Out</button
                        >
                    </div>
                {/if}
            </div>
        </div>
    </header>

    {#if activeTab === "weather"}
        <WeatherTab {data} />
    {:else if activeTab === "tts"}
        <TtsTab {authState} {authInitialized} />
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

    .right-section {
        display: flex;
        align-items: center;
        gap: 20px;
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

    .auth-container {
        display: flex;
        align-items: center;
    }

    .login-btn-header {
        background: #4a90e2;
        color: white;
        border: none;
        padding: 8px 16px;
        border-radius: 6px;
        font-size: 0.9rem;
        font-weight: 600;
        cursor: pointer;
        transition: background 0.2s;
    }

    .login-btn-header:hover {
        background: #357abd;
    }

    .user-info-header {
        display: flex;
        align-items: center;
        gap: 10px;
        background: #333;
        padding: 5px 10px;
        border-radius: 6px;
    }

    .username {
        font-size: 0.9rem;
        font-weight: 600;
        color: #fff;
    }

    .logout-btn-header {
        background: transparent;
        color: #f87171;
        border: 1px solid #f87171;
        padding: 4px 8px;
        border-radius: 4px;
        cursor: pointer;
        font-size: 0.8rem;
        transition: all 0.2s;
    }

    .logout-btn-header:hover {
        background: #f87171;
        color: #000;
    }
</style>
