<script lang="ts">
    import { goto } from "$app/navigation";
    import { page } from "$app/state";
    import type { PageData } from "./$types";
    import {
        Chart as ChartJS,
        Title,
        Tooltip,
        Legend,
        LineElement,
        LinearScale,
        PointElement,
        CategoryScale,
        TimeScale,
    } from "chart.js";

    ChartJS.register(
        Title,
        Tooltip,
        Legend,
        LineElement,
        LinearScale,
        PointElement,
        CategoryScale,
        TimeScale,
    );

    let { data } = $props();

    let activeTab = $state("weather");
    let selectedDate = $state("");
    let selectedDateName = $state("");

    $effect(() => {
        if (data.forecast && data.forecast.length > 0) {
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

    let hourlyData = $derived(
        data.dailyHourlyMap ? data.dailyHourlyMap[selectedDate] : [],
    );

    let currentSelectValue = $derived.by(() => {
        const lat = page.url.searchParams.get("lat");
        const lon = page.url.searchParams.get("lon");
        if (lat && lon) return "current_location";
        return page.url.searchParams.get("location") || "port_melbourne";
    });

    // UV level classification
    let uvLevel = $derived.by(() => {
        const uv = data.uvIndex;
        if (uv === null || uv === undefined) return null;
        if (uv <= 2) return "low";
        if (uv <= 5) return "moderate";
        if (uv <= 7) return "high";
        if (uv <= 10) return "very-high";
        return "extreme";
    });

    // Speedtest Data Processing
    let chartData = $derived.by(() => {
        if (!data.speedtestResults) return null;

        // Sort by timestamp ascending for charts
        const sorted = [...data.speedtestResults].sort(
            (a, b) =>
                new Date(a.timestamp).getTime() -
                new Date(b.timestamp).getTime(),
        );
        const labels = sorted.map((r) =>
            new Date(r.timestamp).toLocaleTimeString(),
        );

        return {
            labels,
            datasets: [
                {
                    label: "Download (Mbps)",
                    data: sorted.map((r) =>
                        (r.download_bandwidth / 125000).toFixed(2),
                    ), // Convert bytes/s to Mbps
                    borderColor: "rgb(75, 192, 192)",
                    tension: 0.1,
                },
                {
                    label: "Upload (Mbps)",
                    data: sorted.map((r) =>
                        (r.upload_bandwidth / 125000).toFixed(2),
                    ),
                    borderColor: "rgb(153, 102, 255)",
                    tension: 0.1,
                },
                {
                    label: "Latency (ms)",
                    data: sorted.map((r) => r.latency_ms),
                    borderColor: "rgb(255, 99, 132)",
                    tension: 0.1,
                    yAxisID: "y1",
                },
            ],
        };
    });

    const chartOptions = {
        responsive: true,
        interaction: {
            mode: "index" as const,
            intersect: false,
        },
        scales: {
            y: {
                type: "linear" as const,
                display: true,
                position: "left" as const,
                title: { display: true, text: "Speed (Mbps)" },
            },
            y1: {
                type: "linear" as const,
                display: true,
                position: "right" as const,
                title: { display: true, text: "Latency (ms)" },
                grid: {
                    drawOnChartArea: false,
                },
            },
        },
    };

    let canvas: HTMLCanvasElement;
    let chartInstance: ChartJS | null = null;

    $effect(() => {
        if (activeTab === "speedtest" && canvas && chartData) {
            if (chartInstance) chartInstance.destroy();
            chartInstance = new ChartJS(canvas, {
                type: "line",
                data: chartData,
                options: chartOptions,
            });
            return () => {
                if (chartInstance) {
                    chartInstance.destroy();
                    chartInstance = null;
                }
            };
        }
    });
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
                class="tab-btn {activeTab === 'speedtest' ? 'active' : ''}"
                onclick={() => (activeTab = "speedtest")}
            >
                Speedtest
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
                    Last updated: {new Date(
                        data.fetchedAt,
                    ).toLocaleTimeString()}
                </div>
            {/if}
        </div>
    </header>

    {#if activeTab === "weather"}
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
                    <div class="stat-value">
                        {data.windSpeed} <small>kn</small>
                    </div>
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
                {#if data.uvIndex !== null}
                    <div class="stat-card uv-card">
                        <div class="stat-icon">☀️</div>
                        <div class="stat-value uv-value uv-{uvLevel}">
                            {data.uvIndex}
                        </div>
                        <div class="stat-label">UV Index</div>
                        {#if data.uvTime}
                            <div class="uv-time">at {data.uvTime}</div>
                        {/if}
                    </div>
                {/if}
            </div>

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
                                    <span class="forecast-high"
                                        >{day.high}°</span
                                    >
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
    {:else if activeTab === "speedtest"}
        <div class="speedtest-container">
            {#if chartData}
                <div class="chart-container">
                    <canvas bind:this={canvas}></canvas>
                </div>

                <div class="table-container">
                    <table>
                        <thead>
                            <tr>
                                <th>Time</th>
                                <th>Server</th>
                                <th>Country</th>
                                <th>Download (Mbps)</th>
                                <th>Upload (Mbps)</th>
                                <th>Latency (ms)</th>
                            </tr>
                        </thead>
                        <tbody>
                            {#each data.speedtestResults as result}
                                <tr>
                                    <td
                                        >{new Date(
                                            result.timestamp,
                                        ).toLocaleString()}</td
                                    >
                                    <td>{result.server_name}</td>
                                    <td>{result.server_country}</td>
                                    <td
                                        >{(
                                            result.download_bandwidth / 125000
                                        ).toFixed(2)}</td
                                    >
                                    <td
                                        >{(
                                            result.upload_bandwidth / 125000
                                        ).toFixed(2)}</td
                                    >
                                    <td>{result.latency_ms}</td>
                                </tr>
                            {/each}
                        </tbody>
                    </table>
                </div>
            {:else}
                <p>No speedtest data available.</p>
            {/if}
        </div>
    {/if}
</div>

<style>
    /* Existing Styles + New Tab Styles */
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

    .main-weather {
        text-align: center;
        margin-bottom: 40px;
    }

    .weather-icon {
        font-size: 4rem;
        margin-bottom: 10px;
    }

    .temperature {
        font-size: 3.5rem;
        font-weight: 700;
    }

    .unit {
        font-size: 1.5rem;
        color: #888;
        vertical-align: top;
    }

    .condition {
        font-size: 1.2rem;
        color: #aaa;
    }

    .stats-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
        gap: 15px;
        margin-bottom: 40px;
    }

    .stat-card {
        background: #2a2a2a;
        padding: 20px;
        border-radius: 15px;
        text-align: center;
        box-shadow: 0 4px 6px rgba(0, 0, 0, 0.3);
    }

    .stat-icon {
        font-size: 1.5rem;
        margin-bottom: 5px;
    }

    .stat-value {
        font-size: 1.2rem;
        font-weight: 600;
    }

    .stat-label {
        font-size: 0.8rem;
        color: #888;
        margin-top: 5px;
    }

    .wind-direction {
        display: inline-block;
        transition: transform 0.5s ease-out;
    }

    .forecast-section {
        background: #2a2a2a;
        border-radius: 20px;
        padding: 20px;
        margin-top: 30px;
    }

    .forecast-title {
        font-size: 1.1rem;
        font-weight: 600;
        margin-bottom: 15px;
        padding-left: 10px;
    }

    .forecast-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(80px, 1fr));
        gap: 10px;
    }

    .forecast-day {
        background: #333;
        padding: 15px 10px;
        border-radius: 12px;
        text-align: center;
        transition: transform 0.2s;
        cursor: pointer;
    }

    .forecast-day:hover {
        transform: translateY(-2px);
        background: #3a3a3a;
    }

    .forecast-day.active {
        background: #4a90e2;
        color: white;
    }

    .forecast-day-name {
        font-size: 0.9rem;
        font-weight: 600;
        margin-bottom: 5px;
    }

    .forecast-icon {
        font-size: 1.5rem;
        margin-bottom: 5px;
    }

    .forecast-temps {
        font-size: 0.9rem;
        margin-bottom: 5px;
    }

    .forecast-high {
        font-weight: 600;
        margin-right: 5px;
    }

    .forecast-low {
        color: #aaa; /* Default low color */
    }

    .forecast-day.active .forecast-low {
        color: #ddd; /* Lighter color when active */
    }

    .forecast-wind {
        font-size: 0.75rem;
        color: #888;
    }

    .forecast-day.active .forecast-wind {
        color: #eee;
    }

    /* Hourly Section */
    .hourly-section {
        background: #2a2a2a;
        border-radius: 20px;
        padding: 20px;
        margin-top: 30px;
        overflow: hidden;
    }

    .hourly-title {
        font-size: 1.1rem;
        font-weight: 600;
        margin-bottom: 15px;
        padding-left: 10px;
    }

    .hourly-scroll {
        display: flex;
        overflow-x: auto;
        gap: 15px;
        padding-bottom: 10px;
        scrollbar-width: thin;
        scrollbar-color: #444 #2a2a2a;
    }

    .hourly-scroll::-webkit-scrollbar {
        height: 8px;
    }
    .hourly-scroll::-webkit-scrollbar-track {
        background: #2a2a2a;
    }
    .hourly-scroll::-webkit-scrollbar-thumb {
        background-color: #444;
        border-radius: 4px;
    }

    .hourly-card {
        background: #333;
        min-width: 80px;
        padding: 15px 10px;
        border-radius: 12px;
        text-align: center;
        flex-shrink: 0;
    }

    .hourly-time {
        font-size: 0.85rem;
        color: #aaa;
        margin-bottom: 5px;
    }

    .hourly-wind {
        font-size: 1.1rem;
        font-weight: 700;
        color: #fff;
    }

    .hourly-unit {
        font-size: 0.7rem;
        color: #888;
    }

    .hourly-dir {
        font-size: 1.2rem;
        margin: 5px 0;
        display: inline-block;
    }

    /* Speedtest Styles */
    .speedtest-container {
        display: flex;
        flex-direction: column;
        gap: 30px;
    }

    .chart-container {
        background: #2a2a2a;
        padding: 20px;
        border-radius: 15px;
        height: 400px;
    }

    .table-container {
        background: #2a2a2a;
        padding: 20px;
        border-radius: 15px;
        overflow-x: auto;
    }

    table {
        width: 100%;
        border-collapse: collapse;
        color: #e0e0e0;
    }

    th,
    td {
        padding: 12px;
        text-align: left;
        border-bottom: 1px solid #444;
    }

    th {
        background-color: #333;
        font-weight: 600;
    }

    tr:hover {
        background-color: #333;
    }

    /* UV Index Card Styles */
    .uv-card {
        position: relative;
    }

    .uv-value {
        font-weight: 700;
    }

    /* UV color coding based on risk level */
    .uv-value.uv-low {
        color: #4ade80; /* Low - green */
    }

    .uv-value.uv-moderate {
        color: #facc15; /* Moderate - yellow */
    }

    .uv-value.uv-high {
        color: #fb923c; /* High - orange */
    }

    .uv-value.uv-very-high {
        color: #f87171; /* Very High - red */
    }

    .uv-value.uv-extreme {
        color: #c084fc; /* Extreme - purple */
    }

    .uv-time {
        font-size: 0.7rem;
        color: #666;
        margin-top: 4px;
    }
</style>
