<script lang="ts">
    import { goto } from "$app/navigation";
    import { page } from "$app/state";
    import type { PageData } from "./$types";

    let { data } = $props();

    let selectedDate = $state("");
    let selectedDateName = $state("");

    $effect(() => {
        if (data.forecast && data.forecast.length > 0) {
            // Only reset if selectedDate is empty or not in the new forecast
            const dateExists = data.forecast.some(
                (d) => d.date === selectedDate,
            );
            if (!selectedDate || !dateExists) {
                selectedDate = data.forecast[0].date;
                selectedDateName = data.forecast[0].name;
            }
        }
    });

    function handleMouseEnter(date: string, name: string) {
        selectedDate = date;
        selectedDateName = name;
    }

    function handleLocationChange(event: Event) {
        const select = event.target as HTMLSelectElement;
        const location = select.value;
        const url = new URL(page.url);
        url.searchParams.set("location", location);
        goto(url);
    }

    let hourlyData = $derived(
        data.dailyHourlyMap ? data.dailyHourlyMap[selectedDate] : [],
    );
</script>

<div class="container">
    <header class="header">
        <div class="location-container">
            <div class="location">📍 {data.location}</div>
            <select
                class="location-select"
                onchange={handleLocationChange}
                value={page.url.searchParams.get("location") ||
                    "port_melbourne"}
            >
                <option value="port_melbourne">Port Melbourne</option>
                <option value="sydney">Sydney</option>
                <option value="hong_kong">Hong Kong</option>
            </select>
        </div>
        <div class="datetime">{data.localTime}</div>
    </header>

    {#if data.error}
        <div class="error-message">
            <p>⚠️ {data.error}</p>
        </div>
    {:else}
        <div class="main-weather">
            <div class="weather-icon">{data.currentIcon}</div>
            <div class="temperature">
                {data.temperature}<span class="unit">°C</span>
            </div>
            <div class="condition">{data.condition}</div>
        </div>

        <div class="stats-grid">
            <div class="stat-card">
                <div class="stat-icon">💨</div>
                <div class="stat-value">{data.windSpeed} <small>kn</small></div>
                <div class="stat-label">Wind Speed</div>
            </div>
            <div class="stat-card">
                <div
                    class="stat-icon wind-direction"
                    style="transform: rotate({data.windDirection}deg);"
                >
                    🧭
                </div>
                <div class="stat-value">{data.windDirectionDesc}</div>
                <div class="stat-label">Wind Direction</div>
            </div>
            <div class="stat-card">
                <div class="stat-icon">🌡️</div>
                <div class="stat-value">{data.humidity}%</div>
                <div class="stat-label">Humidity</div>
            </div>
            <div class="stat-card">
                <div class="stat-icon">☁️</div>
                <div class="stat-value">{data.cloudCover}%</div>
                <div class="stat-label">Cloud Cover</div>
            </div>
        </div>

        <!-- Hourly Details Section (Dynamic) -->
        {#if hourlyData && hourlyData.length > 0}
            <div id="hourly-details" class="hourly-section">
                <div class="hourly-title">
                    <span id="hourly-date-title"
                        >{selectedDateName}'s Wind Forecast</span
                    >
                </div>
                <div class="hourly-scroll" id="hourly-container">
                    {#each hourlyData as h}
                        <div class="hourly-card">
                            <div class="hourly-time">{h.time}</div>
                            <div class="hourly-wind">{h.wind_speed}</div>
                            <div class="hourly-unit">knots</div>
                            <div
                                class="hourly-dir"
                                style="transform: rotate({h.wind_direction}deg)"
                            >
                                ↓
                            </div>
                            <div class="hourly-unit">
                                {h.wind_direction_desc}
                            </div>
                        </div>
                    {/each}
                </div>
            </div>
        {/if}

        {#if data.forecast}
            <div class="forecast-section">
                <div class="forecast-title">7-Day Forecast</div>
                <div class="forecast-grid">
                    {#each data.forecast as day}
                        <!-- svelte-ignore a11y_click_events_have_key_events -->
                        <!-- svelte-ignore a11y_no_static_element_interactions -->
                        <div
                            class="forecast-day {selectedDate === day.date
                                ? 'active'
                                : ''}"
                            onmouseenter={() =>
                                handleMouseEnter(day.date, day.name)}
                        >
                            <div class="forecast-day-name">{day.name}</div>
                            <div class="forecast-icon">{day.icon}</div>
                            <div class="forecast-temps">
                                <span class="forecast-high">{day.high}°</span>
                                <span class="forecast-low">{day.low}°</span>
                            </div>
                            <div class="forecast-wind">
                                💨 {day.max_wind} kn
                            </div>
                        </div>
                    {/each}
                </div>
            </div>
        {/if}
    {/if}
</div>
