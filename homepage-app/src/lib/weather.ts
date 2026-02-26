import { XMLParser } from 'fast-xml-parser';

// Weather code to description and icon mapping
const WEATHER_CODES: Record<number, [string, string]> = {
    0: ["Clear sky", "\u2600\uFE0F"],
    1: ["Mainly clear", "\uD83C\uDF24\uFE0F"],
    2: ["Partly cloudy", "\u26C5"],
    3: ["Overcast", "\u2601\uFE0F"],
    45: ["Foggy", "\uD83C\uDF2B\uFE0F"],
    48: ["Depositing rime fog", "\uD83C\uDF2B\uFE0F"],
    51: ["Light drizzle", "\uD83C\uDF27\uFE0F"],
    53: ["Moderate drizzle", "\uD83C\uDF27\uFE0F"],
    55: ["Dense drizzle", "\uD83C\uDF27\uFE0F"],
    61: ["Slight rain", "\uD83C\uDF27\uFE0F"],
    63: ["Moderate rain", "\uD83C\uDF27\uFE0F"],
    65: ["Heavy rain", "\uD83C\uDF27\uFE0F"],
    66: ["Light freezing rain", "\uD83C\uDF28\uFE0F"],
    67: ["Heavy freezing rain", "\uD83C\uDF28\uFE0F"],
    71: ["Slight snow", "\u2744\uFE0F"],
    73: ["Moderate snow", "\u2744\uFE0F"],
    75: ["Heavy snow", "\u2744\uFE0F"],
    77: ["Snow grains", "\u2744\uFE0F"],
    80: ["Slight rain showers", "\uD83C\uDF26\uFE0F"],
    81: ["Moderate rain showers", "\uD83C\uDF26\uFE0F"],
    82: ["Violent rain showers", "\u26C8\uFE0F"],
    85: ["Slight snow showers", "\uD83C\uDF28\uFE0F"],
    86: ["Heavy snow showers", "\uD83C\uDF28\uFE0F"],
    95: ["Thunderstorm", "\u26C8\uFE0F"],
    96: ["Thunderstorm with slight hail", "\u26C8\uFE0F"],
    99: ["Thunderstorm with heavy hail", "\u26C8\uFE0F"]
};

function degToCompass(num: number): string {
    const val = Math.floor((num / 22.5) + 0.5);
    const arr = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
    return arr[(val % 16)];
}

// Location mapping
export const LOCATIONS: Record<string, { lat: string, lon: string, timezone: string, name: string }> = {
    "port_melbourne": { lat: "-37.8396", lon: "144.9423", timezone: "Australia/Melbourne", name: "Port Melbourne, Australia" },
    "sydney": { lat: "-33.8688", lon: "151.2093", timezone: "Australia/Sydney", name: "Sydney, Australia" },
    "hong_kong": { lat: "22.3193", lon: "114.1694", timezone: "Asia/Hong_Kong", name: "Hong Kong" }
};

// UV location mapping (location key -> ARPANSA station id)
const UV_LOCATION_MAP: Record<string, string> = {
    "sydney": "Sydney",
    "port_melbourne": "Melbourne"
};

export interface WeatherData {
    location: string;
    localTime: string;
    fetchedAt: string | null;
    temperature: number | string | null;
    condition: string | null;
    currentIcon: string | null;
    windSpeed: number | string | null;
    windDirection: number | null;
    windDirectionDesc: string | null;
    humidity: number | string | null;
    cloudCover: number | string | null;
    uvIndex: number | null;
    uvTime: string | null;
    forecast: any[] | null;
    dailyHourlyMap: Record<string, any[]> | null;
    timezone: string | null;
    error: string | null;
}

const fetchWithRetry = async (url: string, retries = 3, timeout = 10000, retryDelay = 2000) => {
    for (let i = 0; i <= retries; i++) {
        const controller = new AbortController();
        const id = setTimeout(() => controller.abort(), timeout);
        try {
            const res = await fetch(url, { signal: controller.signal });
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
async function fetchUVData(): Promise<Record<string, { index: number; time: string }>> {
    try {
        const response = await fetchWithRetry('https://uvdata.arpansa.gov.au/xml/uvvalues.xml', 1, 10000);
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
                    const stationId = typeof id === 'object' ? Object.keys(id)[0] : id;
                    uvData[stationId] = {
                        index: parseFloat(loc.index) || 0,
                        time: loc.time || ''
                    };
                }
            }
        }

        return uvData;
    } catch (error) {
        console.error('Failed to fetch UV data:', error);
        return {};
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

    const response = await fetchWithRetry(`${baseUrl}?${params}`);
    return await response.json();
}

export async function loadWeather(locationKey: string, customLat?: string, customLon?: string): Promise<WeatherData> {
    let lat: string, lon: string, timezone: string, locationName: string;

    if (customLat && customLon) {
        lat = customLat;
        lon = customLon;
        timezone = "auto";
        locationName = "Current Location";
    } else {
        const data = LOCATIONS[locationKey] || LOCATIONS['port_melbourne'];
        lat = data.lat;
        lon = data.lon;
        timezone = data.timezone;
        locationName = data.name;
    }

    try {
        const [weatherRes, uvData] = await Promise.all([
            fetchWeatherData(lat, lon, timezone),
            fetchUVData()
        ]);

        if (!weatherRes) throw new Error("No weather data available");

        const responseTimezone = weatherRes.timezone || timezone;

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

        const temperature = current.temperature_2m ?? 'N/A';
        const weatherCode = current.weather_code ?? 0;
        const windSpeed = current.wind_speed_10m ?? 'N/A';
        const windDirection = current.wind_direction_10m ?? 0;
        const windDirectionDesc = typeof windDirection === 'number' ? degToCompass(windDirection) : "N/A";
        const humidity = current.relative_humidity_2m ?? 'N/A';
        const cloudCover = current.cloud_cover ?? 'N/A';

        const [condition, currentIcon] = WEATHER_CODES[weatherCode] || ["Unknown", "\u2753"];

        // Process forecast data
        const forecast = [];
        const dailyHourlyMap: Record<string, any[]> = {};

        if (daily.time) {
            const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

            for (let i = 0; i < Math.min(daily.time.length, 7); i++) {
                const dateStr = daily.time[i];
                const date = new Date(dateStr);
                const dayCode = daily.weather_code ? daily.weather_code[i] : 0;
                const [, icon] = WEATHER_CODES[dayCode] || ["Unknown", "\u2753"];

                dailyHourlyMap[dateStr] = [];
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

        // Get UV data for Australian locations
        const uvStationId = UV_LOCATION_MAP[locationKey];
        const uvStationData = uvStationId && uvData[uvStationId] ? uvData[uvStationId] : null;
        const uvIndex = uvStationData?.index ?? current.uv_index ?? null;
        const uvTime = uvStationData?.time ?? null;

        return {
            location: locationName,
            localTime,
            fetchedAt: new Date().toISOString(),
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
            forecast,
            dailyHourlyMap,
            timezone: responseTimezone,
            error: null
        };

    } catch (e) {
        const localTime = new Date().toLocaleString();
        return {
            location: locationName!,
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
            forecast: null,
            dailyHourlyMap: null,
            timezone: null
        };
    }
}
