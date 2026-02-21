/**
 * Mock weather data used in CI to avoid external API dependencies.
 * The CI environment variable is set automatically by GitHub Actions.
 */

export function getMockWeatherData(locationName: string) {
    const localTime = new Date().toLocaleString('en-US', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
        hour: '2-digit', minute: '2-digit'
    }).replace(' at ', ' \u2022 ');

    return {
        location: locationName,
        localTime,
        fetchedAt: new Date().toISOString(),
        temperature: 22,
        condition: "Clear sky",
        currentIcon: "\u2600\uFE0F",
        windSpeed: 10,
        windDirection: 180,
        windDirectionDesc: "S",
        humidity: 50,
        cloudCover: 20,
        uvIndex: 3,
        uvTime: null,
        forecast: [
            { date: '2026-01-01', name: 'Today', icon: '\u2600\uFE0F', high: 25, low: 15, max_wind: 15 },
            { date: '2026-01-02', name: 'Mon', icon: '\u26C5', high: 23, low: 14, max_wind: 12 },
        ],
        dailyHourlyMap: {
            '2026-01-01': [
                { time: '9 AM', wind_speed: 8, wind_direction: 180, wind_direction_desc: 'S' },
                { time: '12 PM', wind_speed: 12, wind_direction: 200, wind_direction_desc: 'SSW' },
            ],
            '2026-01-02': [
                { time: '9 AM', wind_speed: 6, wind_direction: 90, wind_direction_desc: 'E' },
            ],
        },
        speedtestResults: [],
        speedtestByLocation: {},
        error: null
    };
}
