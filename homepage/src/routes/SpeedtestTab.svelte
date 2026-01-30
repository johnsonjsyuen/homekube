<script lang="ts">
    import {
        Chart as ChartJS,
        Title,
        Tooltip,
        Legend,
        LineElement,
        LineController,
        LinearScale,
        PointElement,
        CategoryScale,
        TimeScale,
        Filler,
    } from "chart.js";

    ChartJS.register(
        Title,
        Tooltip,
        Legend,
        LineElement,
        LineController,
        LinearScale,
        PointElement,
        CategoryScale,
        TimeScale,
        Filler,
    );

    let { data } = $props();

    // Speedtest Data Processing
    let speedtestByLocation = $derived(
        data.speedtestByLocation as Record<string, any>,
    );

    let selectedLocation = $state<string | null>(null);

    // Get list of locations from the data
    let speedtestLocations = $derived.by(() => {
        if (!speedtestByLocation) return [];
        return Object.keys(speedtestByLocation).sort();
    });

    // Select first location by default
    $effect(() => {
        if (speedtestLocations.length > 0 && !selectedLocation) {
            selectedLocation = speedtestLocations[0];
        }
    });

    // Get location flag emoji
    function getLocationFlag(locationName: string): string {
        const flags: Record<string, string> = {
            Local: "🏠",
            Melbourne: "🇦🇺",
            Sydney: "🇦🇺",
            "Los Angeles": "🇺🇸",
            Atlanta: "🇺🇸",
            "New York": "🇺🇸",
            "Hong Kong": "🇭🇰",
            London: "🇬🇧",
        };
        return flags[locationName] || "🌐";
    }

    // Latency color coding
    function getLatencyColor(latency: number): string {
        if (latency < 50) return "#4ade80"; // green
        if (latency < 100) return "#facc15"; // yellow
        if (latency < 200) return "#fb923c"; // orange
        return "#f87171"; // red
    }

    // Format speed for display
    function formatSpeed(bandwidth: number): string {
        const mbps = bandwidth / 125000;
        return mbps.toFixed(1);
    }

    // Time ago formatting
    function timeAgo(timestamp: string): string {
        const now = new Date();
        const then = new Date(timestamp);
        const diffMs = now.getTime() - then.getTime();
        const diffMins = Math.floor(diffMs / 60000);
        if (diffMins < 60) return `${diffMins}m ago`;
        const diffHours = Math.floor(diffMins / 60);
        if (diffHours < 24) return `${diffHours}h ago`;
        return `${Math.floor(diffHours / 24)}d ago`;
    }

    // Chart data for selected location
    let chartData = $derived.by(() => {
        if (!speedtestByLocation || !selectedLocation) return null;
        const locationData = speedtestByLocation[selectedLocation];
        if (!locationData || !locationData.results) return null;

        // Sort by timestamp ascending for charts
        const sorted = [...locationData.results].sort(
            (a, b) =>
                new Date(a.timestamp).getTime() -
                new Date(b.timestamp).getTime(),
        );
        const labels = sorted.map((r) =>
            new Date(r.timestamp).toLocaleString("en-US", {
                month: "short",
                day: "numeric",
                hour: "numeric",
            }),
        );

        return {
            labels,
            datasets: [
                {
                    label: "Download (Mbps)",
                    data: sorted.map((r) =>
                        (r.download_bandwidth / 125000).toFixed(2),
                    ),
                    borderColor: "rgb(75, 192, 192)",
                    backgroundColor: "rgba(75, 192, 192, 0.1)",
                    fill: true,
                    tension: 0.3,
                },
                {
                    label: "Upload (Mbps)",
                    data: sorted.map((r) =>
                        (r.upload_bandwidth / 125000).toFixed(2),
                    ),
                    borderColor: "rgb(153, 102, 255)",
                    backgroundColor: "rgba(153, 102, 255, 0.1)",
                    fill: true,
                    tension: 0.3,
                },
                {
                    label: "Latency (ms)",
                    data: sorted.map((r) => r.latency_ms),
                    borderColor: "rgb(255, 99, 132)",
                    tension: 0.3,
                    yAxisID: "y1",
                },
            ],
        };
    });

    const chartOptions = {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
            mode: "index" as const,
            intersect: false,
        },
        plugins: {
            legend: {
                labels: { color: "#e0e0e0" },
            },
        },
        scales: {
            x: {
                ticks: { color: "#888" },
                grid: { color: "#333" },
            },
            y: {
                type: "linear" as const,
                display: true,
                position: "left" as const,
                title: { display: true, text: "Speed (Mbps)", color: "#888" },
                ticks: { color: "#888" },
                grid: { color: "#333" },
            },
            y1: {
                type: "linear" as const,
                display: true,
                position: "right" as const,
                title: { display: true, text: "Latency (ms)", color: "#888" },
                ticks: { color: "#888" },
                grid: {
                    drawOnChartArea: false,
                },
            },
        },
    };

    let canvas = $state<HTMLCanvasElement>();
    let chartInstance: ChartJS | null = null;

    $effect(() => {
        if (canvas && chartData) {
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

<div class="speedtest-container">
    {#if speedtestByLocation && Object.keys(speedtestByLocation).length > 0}
        <!-- Location Summary Cards -->
        <div class="location-cards">
            {#each speedtestLocations as location}
                {@const locData = speedtestByLocation[location]}
                {#if locData && locData.latest}
                    <!-- svelte-ignore a11y_click_events_have_key_events -->
                    <!-- svelte-ignore a11y_no_static_element_interactions -->
                    <div
                        class="location-card {selectedLocation === location
                            ? 'active'
                            : ''}"
                        onclick={() => (selectedLocation = location)}
                    >
                        <div class="location-header">
                            <span class="location-flag"
                                >{getLocationFlag(location)}</span
                            >
                            <span class="location-name">{location}</span>
                        </div>
                        <div class="location-speeds">
                            <div class="speed-item download">
                                <span class="speed-label">↓</span>
                                <span class="speed-value"
                                    >{formatSpeed(
                                        locData.latest.download_bandwidth,
                                    )}</span
                                >
                                <span class="speed-unit">Mbps</span>
                            </div>
                            <div class="speed-item upload">
                                <span class="speed-label">↑</span>
                                <span class="speed-value"
                                    >{formatSpeed(
                                        locData.latest.upload_bandwidth,
                                    )}</span
                                >
                                <span class="speed-unit">Mbps</span>
                            </div>
                        </div>
                        <div
                            class="location-latency"
                            style="color: {getLatencyColor(
                                locData.latest.latency_ms,
                            )}"
                        >
                            {locData.latest.latency_ms.toFixed(1)} ms
                        </div>
                        <div class="location-time">
                            {timeAgo(locData.latest.timestamp)}
                        </div>
                        <div class="location-avg">
                            <small
                                >Avg: ↓{formatSpeed(locData.avg_download)} ↑{formatSpeed(
                                    locData.avg_upload,
                                )}</small
                            >
                        </div>
                    </div>
                {/if}
            {/each}
        </div>

        <!-- Chart Section -->
        {#if selectedLocation && chartData}
            <div class="chart-section">
                <div class="chart-header">
                    <h3>
                        {getLocationFlag(selectedLocation)}
                        {selectedLocation} - Speed Trends
                    </h3>
                </div>
                <div class="chart-container">
                    <canvas bind:this={canvas}></canvas>
                </div>
            </div>
        {/if}

        <!-- Table Section with Location Filter -->
        <div class="table-section">
            <div class="table-header">
                <h3>Recent Results</h3>
                <div class="table-filter">
                    <label for="table-location-filter">Filter:</label>
                    <select
                        id="table-location-filter"
                        bind:value={selectedLocation}
                    >
                        {#each speedtestLocations as loc}
                            <option value={loc}>{loc}</option>
                        {/each}
                    </select>
                </div>
            </div>
            <div class="table-container">
                <table>
                    <thead>
                        <tr>
                            <th>Time</th>
                            <th>Download</th>
                            <th>Upload</th>
                            <th>Latency</th>
                        </tr>
                    </thead>
                    <tbody>
                        {#each ((selectedLocation && speedtestByLocation[selectedLocation]?.results) || []).slice(0, 20) as result}
                            <tr>
                                <td
                                    >{new Date(
                                        result.timestamp,
                                    ).toLocaleString()}</td
                                >
                                <td class="speed-cell download"
                                    >{formatSpeed(result.download_bandwidth)} Mbps</td
                                >
                                <td class="speed-cell upload"
                                    >{formatSpeed(result.upload_bandwidth)} Mbps</td
                                >
                                <td
                                    style="color: {getLatencyColor(
                                        result.latency_ms,
                                    )}">{result.latency_ms.toFixed(1)} ms</td
                                >
                            </tr>
                        {/each}
                    </tbody>
                </table>
            </div>
        </div>
    {:else}
        <p class="no-data">No speedtest data available.</p>
    {/if}
</div>

<style>
    /* Speedtest Styles */
    .speedtest-container {
        display: flex;
        flex-direction: column;
        gap: 25px;
    }

    /* Location Cards Grid */
    .location-cards {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
        gap: 12px;
    }

    .location-card {
        background: #2a2a2a;
        padding: 14px;
        border-radius: 15px;
        cursor: pointer;
        transition: all 0.2s ease;
        border: 2px solid transparent;
        overflow: hidden;
        min-width: 0;
    }

    .location-card:hover {
        background: #333;
        transform: translateY(-2px);
    }

    .location-card.active {
        border-color: #4a90e2;
        background: linear-gradient(135deg, #2a3a4a 0%, #2a2a2a 100%);
    }

    .location-header {
        display: flex;
        align-items: center;
        gap: 6px;
        margin-bottom: 10px;
        overflow: hidden;
    }

    .location-flag {
        font-size: 1.1rem;
        flex-shrink: 0;
    }

    .location-name {
        font-weight: 600;
        font-size: 0.85rem;
        color: #fff;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .location-speeds {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-bottom: 6px;
    }

    .speed-item {
        display: flex;
        align-items: baseline;
        gap: 2px;
    }

    .speed-label {
        font-size: 0.8rem;
        font-weight: 600;
    }

    .speed-item.download .speed-label {
        color: rgb(75, 192, 192);
    }

    .speed-item.upload .speed-label {
        color: rgb(153, 102, 255);
    }

    .speed-value {
        font-size: 0.95rem;
        font-weight: 700;
        color: #fff;
    }

    .speed-unit {
        font-size: 0.6rem;
        color: #888;
    }

    .location-latency {
        font-size: 0.85rem;
        font-weight: 600;
        margin-bottom: 4px;
    }

    .location-time {
        font-size: 0.7rem;
        color: #666;
    }

    .location-avg {
        margin-top: 8px;
        padding-top: 8px;
        border-top: 1px solid #444;
        color: #888;
        overflow: hidden;
    }

    .location-avg small {
        font-size: 0.7rem;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        display: block;
    }

    /* Chart Section */
    .chart-section {
        background: #2a2a2a;
        border-radius: 15px;
        overflow: hidden;
    }

    .chart-header {
        padding: 15px 20px 0;
    }

    .chart-header h3 {
        margin: 0;
        font-size: 1rem;
        color: #e0e0e0;
    }

    .chart-container {
        padding: 15px 20px 20px;
        height: 350px;
    }

    /* Table Section */
    .table-section {
        background: #2a2a2a;
        border-radius: 15px;
        overflow: hidden;
    }

    .table-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 15px 20px;
        border-bottom: 1px solid #333;
    }

    .table-header h3 {
        margin: 0;
        font-size: 1rem;
        color: #e0e0e0;
    }

    .table-filter {
        display: flex;
        align-items: center;
        gap: 8px;
    }

    .table-filter label {
        font-size: 0.85rem;
        color: #888;
    }

    .table-filter select {
        background: #333;
        color: #fff;
        border: 1px solid #444;
        padding: 6px 12px;
        border-radius: 6px;
        font-size: 0.85rem;
    }

    .table-container {
        padding: 0 20px 20px;
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
        border-bottom: 1px solid #333;
    }

    th {
        background-color: transparent;
        font-weight: 600;
        color: #888;
    }

    tr:hover {
        background-color: #333;
    }

    .speed-cell.download {
        color: rgb(75, 192, 192);
    }

    .speed-cell.upload {
        color: rgb(153, 102, 255);
    }

    .no-data {
        text-align: center;
        color: #666;
        padding: 40px;
    }
</style>
