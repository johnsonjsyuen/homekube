<script lang="ts">
    let { data } = $props();

    let selectedDate = $state("");
    let selectedDateName = $state("");

    $effect(() => {
        if (data.forecast && data.forecast.length > 0) {
            const dateExists = data.forecast.some(
                (d: any) => d.date === selectedDate,
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

    let hourlyData = $derived(
        data.dailyHourlyMap ? data.dailyHourlyMap[selectedDate] : [],
    );

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
</script>

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

<style>
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

    .error-message {
        background-color: #f8d7da;
        color: #721c24;
        padding: 10px;
        border-radius: 5px;
        margin-bottom: 20px;
        text-align: center;
    }
</style>
