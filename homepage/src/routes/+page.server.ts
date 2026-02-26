import type { PageServerLoad } from './$types';
import { XMLParser } from 'fast-xml-parser';
import { getMockWeatherData } from '$lib/mock-weather';

// In CI/test environments, use faster timeouts to avoid flaky tests
const isCI = typeof process !== 'undefined' && process.env?.CI === 'true';

// Weather code to description and icon mapping
const WEATHER_CODES: Record<number, [string, string]> = {
    0: ["Clear sky", "☀️"],
    1: ["Mainly clear", "🌤️"],
    2: ["Partly cloudy", "⛅"],
    3: ["Overcast", "☁️"],
    45: ["Foggy", "🌫️"],
    48: ["Depositing rime fog", "🌫️"],
    51: ["Light drizzle", "🌧️"],
    53: ["Moderate drizzle", "🌧️"],
    55: ["Dense drizzle", "🌧️"],
    61: ["Slight rain", "🌧️"],
    63: ["Moderate rain", "🌧️"],
    65: ["Heavy rain", "🌧️"],
    66: ["Light freezing rain", "🌨️"],
    67: ["Heavy freezing rain", "🌨️"],
    71: ["Slight snow", "❄️"],
    73: ["Moderate snow", "❄️"],
    75: ["Heavy snow", "❄️"],
    77: ["Snow grains", "❄️"],
    80: ["Slight rain showers", "🌦️"],
    81: ["Moderate rain showers", "🌦️"],
    82: ["Violent rain showers", "⛈️"],
    85: ["Slight snow showers", "🌨️"],
    86: ["Heavy snow showers", "🌨️"],
    95: ["Thunderstorm", "⛈️"],
    96: ["Thunderstorm with slight hail", "⛈️"],
    99: ["Thunderstorm with heavy hail", "⛈️"]
};

function degToCompass(num: number): string {
    const val = Math.floor((num / 22.5) + 0.5);
    const arr = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
    return arr[(val % 16)];
}

// Location mapping
const LOCATIONS: Record<string, { lat: string, lon: string, timezone: string, name: string }> = {
    "port_melbourne": { lat: "-37.8396", lon: "144.9423", timezone: "Australia/Melbourne", name: "Port Melbourne, Australia" },
    "sydney": { lat: "-33.8688", lon: "151.2093", timezone: "Australia/Sydney", name: "Sydney, Australia" },
    "hong_kong": { lat: "22.3193", lon: "114.1694", timezone: "Asia/Hong_Kong", name: "Hong Kong" }
};

// Cache for saved locations (stores weather data with fetch timestamp)
let weatherCache: Record<string, { data: any; fetchedAt: Date }> = {};

// Cache for UV data from ARPANSA
let uvCache: { data: Record<string, { index: number; time: string }>; fetchedAt: Date | null } = {
    data: {},
    fetchedAt: null
};

// UV location mapping (location key -> ARPANSA station id)
const UV_LOCATION_MAP: Record<string, string> = {
    "sydney": "Sydney",
    "port_melbourne": "Melbourne"
};

// UV chart coordinates (location key -> ARPANSA API lat/lon)
const UV_CHART_COORDS: Record<string, { lat: number; lon: number }> = {
    "port_melbourne": { lat: -37.73, lon: 145.1 },
    "sydney": { lat: -34.04, lon: 151.1 }
};

// Cache for UV chart data from ARPANSA JSON API
let uvChartCache: Record<string, { data: any; fetchedAt: Date }> = {};

const fetchWithRetry = async (url: string, retries = 3, timeout = 10000, retryDelay = 2000) => {
    for (let i = 0; i <= retries; i++) {
        const controller = new AbortController();
        const id = setTimeout(() => controller.abort(), timeout);
        try {
            console.log(`Fetching ${url} (attempt ${i + 1}/${retries + 1})...`);
            const res = await fetch(url, {
                headers: {
                    'User-Agent': 'WeatherApp/1.0 (homekube)'
                },
                signal: controller.signal
            });
            clearTimeout(id);
            if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
            return res;
        } catch (err) {
            clearTimeout(id);
            if (i === retries) throw err;
            console.warn(`Fetch attempt ${i + 1} failed, retrying in ${retryDelay}ms...`, err);
            await new Promise(r => setTimeout(r, retryDelay));
        }
    }
    throw new Error("Should not be reached");
};

// Fetch UV data from ARPANSA
async function fetchUVData() {
    try {
        console.log('Fetching UV data from ARPANSA...');
        const response = await fetchWithRetry('https://uvdata.arpansa.gov.au/xml/uvvalues.xml', isCI ? 0 : 1, isCI ? 3000 : 10000);
        const xmlText = await response.text();

        const parser = new XMLParser({ ignoreAttributes: false });
        const result = parser.parse(xmlText);

        const uvData: Record<string, { index: number; time: string }> = {};

        if (result.stations?.location) {
            const locations = Array.isArray(result.stations.location)
                ? result.stations.location
                : [result.stations.location];

            for (const loc of locations) {
                const id = loc['@_id'] || loc.id;
                if (id) {
                    // Handle both attribute (@_id) and element (id) based on parser config
                    const stationId = typeof id === 'object' ? Object.keys(id)[0] : id;
                    uvData[stationId] = {
                        index: parseFloat(loc.index) || 0,
                        time: loc.time || ''
                    };
                }
            }
        }

        uvCache = { data: uvData, fetchedAt: new Date() };
        console.log(`UV data updated. Stations: ${Object.keys(uvData).join(', ')}`);
    } catch (error) {
        console.error('Failed to fetch UV data:', error);
    }
}

// Initial UV fetch and schedule refreshes
fetchUVData();
setInterval(fetchUVData, 15 * 60 * 1000);

// Fetch UV chart data from ARPANSA JSON API
async function fetchUVChartData(locationKey: string): Promise<{ tableData: any[] | null; maxUV: number | null; maxUVTime: string | null }> {
    const coords = UV_CHART_COORDS[locationKey];
    if (!coords) return { tableData: null, maxUV: null, maxUVTime: null };

    // Check cache (15-minute TTL)
    const cached = uvChartCache[locationKey];
    if (cached && (Date.now() - cached.fetchedAt.getTime()) < 15 * 60 * 1000) {
        return cached.data;
    }

    try {
        // Format today's date as DD-MM-YYYY in the station's local timezone
        const tz = LOCATIONS[locationKey]?.timezone ?? 'Australia/Melbourne';
        const now = new Date();
        const formatter = new Intl.DateTimeFormat('en-AU', { timeZone: tz, day: '2-digit', month: '2-digit', year: 'numeric' });
        const parts = formatter.formatToParts(now);
        const day = parts.find(p => p.type === 'day')!.value;
        const month = parts.find(p => p.type === 'month')!.value;
        const year = parts.find(p => p.type === 'year')!.value;
        const dateStr = `${day}-${month}-${year}`;

        const url = `https://uvdata.arpansa.gov.au/api/uvlevel/?longitude=${coords.lon}&latitude=${coords.lat}&date=${dateStr}`;
        const response = await fetchWithRetry(url, isCI ? 0 : 1, isCI ? 3000 : 10000);
        const json = await response.json();

        const result = {
            tableData: json.TableData || null,
            maxUV: json.MaximumUVLevel ?? null,
            maxUVTime: json.MaximumUVLevelDateTime ?? null
        };

        uvChartCache[locationKey] = { data: result, fetchedAt: new Date() };
        console.log(`UV chart data updated for ${locationKey}`);
        return result;
    } catch (error) {
        console.warn(`Failed to fetch UV chart data for ${locationKey}:`, error);
        return { tableData: null, maxUV: null, maxUVTime: null };
    }
}

async function fetchWeatherData(lat: string, lon: string, timezone: string) {
    const baseUrl = "https://api.open-meteo.com/v1/forecast";
    const params = new URLSearchParams({
        "latitude": lat,
        "longitude": lon,
        "current": "temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m,wind_direction_10m,cloud_cover,uv_index",
        "daily": "weather_code,temperature_2m_max,temperature_2m_min,wind_speed_10m_max",
        "hourly": "wind_speed_10m,wind_direction_10m",
        "wind_speed_unit": "kn",
        "timezone": timezone
    });

    const response = await fetchWithRetry(
        `${baseUrl}?${params}`,
        isCI ? 1 : 3,
        isCI ? 5000 : 10000
    );
    return await response.json();
}

async function updateSavedLocationsCache(locationsToUpdate?: string[]) {
    const keysToFetch = locationsToUpdate || Object.keys(LOCATIONS);
    console.log(`Refreshing weather cache for: ${keysToFetch.join(', ')}...`);

    const failedKeys: string[] = [];

    for (const key of keysToFetch) {
        const data = LOCATIONS[key];
        if (!data) {
            console.warn(`Unknown location key: ${key}`);
            continue;
        }
        try {
            const weatherData = await fetchWeatherData(data.lat, data.lon, data.timezone);
            if (weatherData) {
                weatherCache[key] = { data: weatherData, fetchedAt: new Date() };
            } else {
                console.warn(`Received empty data for ${key}`);
                failedKeys.push(key);
            }
        } catch (error) {
            console.error(`Failed to update cache for ${key}:`, error);
            failedKeys.push(key);
        }
    }

    if (failedKeys.length > 0) {
        console.log(`Failed to fetch: ${failedKeys.join(', ')}. Retrying in ${isCI ? 2 : 10} seconds...`);
        setTimeout(() => updateSavedLocationsCache(failedKeys), isCI ? 2000 : 10000);
    }

    // Schedule next full refresh only if this was a full refresh (not a retry of failed locations)
    if (!locationsToUpdate) {
        setTimeout(updateSavedLocationsCache, 15 * 60 * 1000);
    }
}

// Track initial cache population status
let cacheInitialized = false;
let cacheInitPromise: Promise<void> | null = null;

// Initialize cache and track completion
async function initializeCache() {
    try {
        await updateSavedLocationsCache();
        cacheInitialized = true;
        console.log('Weather cache initialized successfully');
    } catch (error) {
        console.error('Failed to initialize weather cache:', error);
        // Even if initial fetch fails, mark as initialized so we don't block forever
        cacheInitialized = true;
    }
}

// Start initial fetch
cacheInitPromise = initializeCache();

// Speedtest Cache
let speedtestCache: {
    data: Record<string, {
        latest: any;
        results: any[];
        avg_download: number;
        avg_upload: number;
        avg_latency: number;
    }>;
    fetchedAt: Date | null;
    results: any[];
} = {
    data: {},
    fetchedAt: null,
    results: []
};

async function fetchSpeedtestData() {
    try {
        console.log('Fetching speedtest data...');
        // Shorter timeout for background refresh
        const res = await fetchWithRetry('http://speedtest/api/results/by-location', 2, 5000, 1000);
        const speedtestByLocation = await res.json();

        const results: any[] = [];
        for (const [, data] of Object.entries(speedtestByLocation)) {
            // @ts-ignore
            results.push(...data.results);
        }
        results.sort((a, b) =>
            new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
        );

        speedtestCache = {
            data: speedtestByLocation,
            results: results,
            fetchedAt: new Date()
        };
        console.log(`Speedtest data updated. Locations: ${Object.keys(speedtestByLocation).join(', ')}`);
    } catch (e) {
        console.error("Error fetching speedtest results (background):", e);
    }
}

// Initial fetch and schedule refreshes
// fetchSpeedtestData();
// setInterval(fetchSpeedtestData, 5 * 60 * 1000); // Refresh every 5 minutes

export const load: PageServerLoad = async ({ url }) => {
    const latParam = url.searchParams.get('lat');
    const lonParam = url.searchParams.get('lon');
    const locationKey = url.searchParams.get('location');

    // In CI, return mock weather data to avoid external API dependency
    if (isCI) {
        let locationName: string;
        if (latParam && lonParam) {
            locationName = "Current Location";
        } else {
            const key = locationKey || 'port_melbourne';
            const loc = LOCATIONS[key] || LOCATIONS['port_melbourne'];
            locationName = loc.name;
        }
        return getMockWeatherData(locationName);
    }

    // Wait for initial cache population (with timeout to prevent indefinite blocking)
    if (!cacheInitialized && cacheInitPromise) {
        console.log('Waiting for cache initialization...');
        await Promise.race([
            cacheInitPromise,
            new Promise(resolve => setTimeout(resolve, isCI ? 10000 : 30000))
        ]);
    }

    let lat: string, lon: string, timezone: string, locationName: string;
    let weatherRes;
    let fetchError;
    let fetchedAt: Date | null = null;

    // Use cached speedtest data immediately
    const speedtestByLocation = speedtestCache.data;
    const speedtestResults = speedtestCache.results;

    if (latParam && lonParam) {
        lat = latParam;
        lon = lonParam;
        timezone = "auto";
        locationName = "Current Location";
        try {
            weatherRes = await fetchWeatherData(lat, lon, timezone);
            fetchedAt = new Date();
        } catch (e) {
            console.error("Error fetching current location weather:", e);
            fetchError = e;
            weatherRes = null;
        }
    } else {
        const key = locationKey || 'port_melbourne';
        const data = LOCATIONS[key] || LOCATIONS['port_melbourne'];
        lat = data.lat;
        lon = data.lon;
        timezone = data.timezone;
        locationName = data.name;

        if (weatherCache[key]) {
            console.log(`Cache hit for ${key}`);
            weatherRes = weatherCache[key].data;
            fetchedAt = weatherCache[key].fetchedAt;
        } else {
            console.log(`Cache miss for ${key}, fetching...`);
            try {
                weatherRes = await fetchWeatherData(lat, lon, timezone);
                fetchedAt = new Date();
            } catch (e) {
                console.error(`Error fetching weather for ${key}:`, e);
                fetchError = e;
                weatherRes = null;
            }
        }
    }

    try {
        if (!weatherRes) throw fetchError || new Error("No weather data available");

        // Use the timezone returned by the API if we used "auto", or the one we requested
        const responseTimezone = weatherRes.timezone || timezone;

        // Local time in target location
        const options: Intl.DateTimeFormatOptions = {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            timeZone: responseTimezone
        };
        const localTime = new Date().toLocaleString('en-US', options).replace(' at ', ' • ');


        const current = weatherRes.current || {};
        const daily = weatherRes.daily || {};
        const hourly = weatherRes.hourly || {};

        // Current weather data
        const temperature = current.temperature_2m ?? 'N/A';
        const weatherCode = current.weather_code ?? 0;
        const windSpeed = current.wind_speed_10m ?? 'N/A';
        const windDirection = current.wind_direction_10m ?? 0;
        const windDirectionDesc = typeof windDirection === 'number' ? degToCompass(windDirection) : "N/A";
        const humidity = current.relative_humidity_2m ?? 'N/A';
        const cloudCover = current.cloud_cover ?? 'N/A';

        const [condition, currentIcon] = WEATHER_CODES[weatherCode] || ["Unknown", "❓"];

        // Process forecast data
        const forecast = [];
        const dailyHourlyMap: Record<string, any[]> = {};

        if (daily.time) {
            const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

            for (let i = 0; i < Math.min(daily.time.length, 7); i++) {
                const dateStr = daily.time[i];
                const date = new Date(dateStr);
                const dayCode = daily.weather_code ? daily.weather_code[i] : 0;
                const [, icon] = WEATHER_CODES[dayCode] || ["Unknown", "❓"];


                dailyHourlyMap[dateStr] = []; // Initialize
                if (hourly.time) {
                    for (let hIdx = 0; hIdx < hourly.time.length; hIdx++) {
                        const hTime = hourly.time[hIdx];
                        if (hTime.startsWith(dateStr)) {
                            const hourDt = new Date(hTime);
                            const hWindDir = hourly.wind_direction_10m[hIdx];
                            dailyHourlyMap[dateStr].push({
                                'time': hourDt.toLocaleTimeString('en-US', { hour: 'numeric', hour12: true }),
                                'wind_speed': hourly.wind_speed_10m[hIdx],
                                'wind_direction': hWindDir,
                                'wind_direction_desc': typeof hWindDir === 'number' ? degToCompass(hWindDir) : "N/A"
                            });
                        }
                    }
                }

                forecast.push({
                    'date': dateStr,
                    'name': i > 0 ? dayNames[date.getDay()] : 'Today',
                    'icon': icon,
                    'high': Math.round(daily.temperature_2m_max ? daily.temperature_2m_max[i] : 0),
                    'low': Math.round(daily.temperature_2m_min ? daily.temperature_2m_min[i] : 0),
                    'max_wind': daily.wind_speed_10m_max ? daily.wind_speed_10m_max[i] : 0
                });
            }
        }

        // Get UV data for Australian locations (ARPANSA)
        const locationKeyForUV = locationKey || 'port_melbourne';
        const uvStationId = UV_LOCATION_MAP[locationKeyForUV];
        const uvData = uvStationId && uvCache.data[uvStationId] ? uvCache.data[uvStationId] : null;

        // Use ARPANSA UV if available, otherwise fallback to OpenMeteo
        const uvIndex = uvData?.index ?? current.uv_index ?? null;
        const uvTime = uvData?.time ?? null; // OpenMeteo is "current", so no specific time label needed

        // Fetch UV chart data for Australian locations
        const uvChartResult = await fetchUVChartData(locationKeyForUV);

        return {
            location: locationName,
            localTime,
            fetchedAt: fetchedAt?.toISOString() || null,
            temperature,
            condition,
            currentIcon,
            windSpeed,
            windDirection,
            windDirectionDesc,
            humidity,
            cloudCover,
            uvIndex,
            uvTime,
            uvChartData: uvChartResult.tableData,
            uvChartMax: uvChartResult.maxUV,
            uvChartMaxTime: uvChartResult.maxUVTime,
            forecast,
            dailyHourlyMap,
            speedtestResults,
            speedtestByLocation,
            error: null
        };

    } catch (e) {
        // Fallback time if fetch fails (using UTC or system time as best effort, or just empty)
        const localTime = new Date().toLocaleString();
        return {
            location: locationName,
            localTime,
            fetchedAt: null,
            error: String(e),
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
            uvChartData: null,
            uvChartMax: null,
            uvChartMaxTime: null,
            forecast: null,
            dailyHourlyMap: null,
            speedtestResults: [],
            speedtestByLocation: {}
        };
    }
};
