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

export const load: PageServerLoad = async () => {
    // Port Melbourne coordinates
    const baseUrl = "https://api.open-meteo.com/v1/forecast";
    const params = new URLSearchParams({
        "latitude": "-37.8396",
        "longitude": "144.9423",
        "current": "temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m,wind_direction_10m,cloud_cover",
        "daily": "weather_code,temperature_2m_max,temperature_2m_min,wind_speed_10m_max",
        "hourly": "wind_speed_10m,wind_direction_10m",
        "wind_speed_unit": "kn",
        "timezone": "Australia/Melbourne"
    });

    // Local time in Melbourne
    const options: Intl.DateTimeFormatOptions = {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Australia/Melbourne'
    };
    const localTime = new Date().toLocaleString('en-US', options).replace(' at ', ' • ');

    try {
        const response = await fetch(`${baseUrl}?${params}`);
        const weatherRes = await response.json();

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
            location: "Port Melbourne, Australia",
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
            error: null
        };

    } catch (e) {
        return {
            location: "Port Melbourne, Australia",
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
            dailyHourlyMap: null
        };
    }
};
