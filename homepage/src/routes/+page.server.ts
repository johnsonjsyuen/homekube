import type { PageServerLoad } from './$types';

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

// Cache for saved locations
let weatherCache: Record<string, any> = {};

const fetchWithRetry = async (url: string, retries = 1, timeout = 10000) => {
    for (let i = 0; i <= retries; i++) {
        const controller = new AbortController();
        const id = setTimeout(() => controller.abort(), timeout);
        try {
            console.log(`Fetching weather data (attempt ${i + 1}/${retries + 1})...`);
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
            console.warn(`Fetch attempt ${i + 1} failed, retrying...`, err);
            await new Promise(r => setTimeout(r, 1000));
        }
    }
    throw new Error("Should not be reached");
};

async function fetchWeatherData(lat: string, lon: string, timezone: string) {
    const baseUrl = "https://api.open-meteo.com/v1/forecast";
    const params = new URLSearchParams({
        "latitude": lat,
        "longitude": lon,
        "current": "temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m,wind_direction_10m,cloud_cover",
        "daily": "weather_code,temperature_2m_max,temperature_2m_min,wind_speed_10m_max",
        "hourly": "wind_speed_10m,wind_direction_10m",
        "wind_speed_unit": "kn",
        "timezone": timezone
    });

    const response = await fetchWithRetry(`${baseUrl}?${params}`);
    return await response.json();
}

async function updateSavedLocationsCache() {
    console.log("Refreshing weather cache for saved locations...");
    let allSuccess = true;
    for (const [key, data] of Object.entries(LOCATIONS)) {
        try {
            const weatherData = await fetchWeatherData(data.lat, data.lon, data.timezone);
            if (weatherData) {
                weatherCache[key] = weatherData;
            } else {
                console.warn(`Received empty data for ${key}`);
                allSuccess = false;
            }
        } catch (error) {
            console.error(`Failed to update cache for ${key}:`, error);
            allSuccess = false;
        }
    }

    const delay = allSuccess ? 15 * 60 * 1000 : 10 * 1000;
    if (!allSuccess) {
        console.log("Some updates failed, retrying in 10 seconds...");
    }
    setTimeout(updateSavedLocationsCache, delay);
}

// Initial fetch
updateSavedLocationsCache();

export const load: PageServerLoad = async ({ url }) => {
    const latParam = url.searchParams.get('lat');
    const lonParam = url.searchParams.get('lon');
    const locationKey = url.searchParams.get('location');

    let lat: string, lon: string, timezone: string, locationName: string;
    let weatherRes;
    let fetchError;

    // Fetch speedtest results from speedtest API
    let speedtestResults = [];
    try {
        const res = await fetch('http://speedtest:3000/api/results');
        if (res.ok) {
            speedtestResults = await res.json();
        } else {
            console.error("Error fetching speedtest results:", res.status);
        }
    } catch (e) {
        console.error("Error fetching speedtest results:", e);
    }

    if (latParam && lonParam) {
        lat = latParam;
        lon = lonParam;
        timezone = "auto";
        locationName = "Current Location";
        try {
            weatherRes = await fetchWeatherData(lat, lon, timezone);
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
            weatherRes = weatherCache[key];
        } else {
            console.log(`Cache miss for ${key}, fetching...`);
            try {
                weatherRes = await fetchWeatherData(lat, lon, timezone);
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

        return {
            location: locationName,
            localTime,
            temperature,
            condition,
            currentIcon,
            windSpeed,
            windDirection,
            windDirectionDesc,
            humidity,
            cloudCover,
            forecast,
            dailyHourlyMap,
            speedtestResults,
            error: null
        };

    } catch (e) {
        // Fallback time if fetch fails (using UTC or system time as best effort, or just empty)
        const localTime = new Date().toLocaleString();
        return {
            location: locationName,
            localTime,
            error: String(e),
            temperature: null,
            condition: null,
            currentIcon: null,
            windSpeed: null,
            windDirection: null,
            humidity: null,
            cloudCover: null,
            forecast: null,
            dailyHourlyMap: null,
            speedtestResults: []
        };
    }
};
