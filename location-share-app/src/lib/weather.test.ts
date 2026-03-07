import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loadWeather, LOCATIONS } from './weather';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Sample API response matching Open-Meteo format
const mockWeatherResponse = {
    timezone: 'Australia/Melbourne',
    current: {
        temperature_2m: 22.5,
        relative_humidity_2m: 65,
        weather_code: 2,
        wind_speed_10m: 12.3,
        wind_direction_10m: 180,
        cloud_cover: 40,
        uv_index: 5.2,
    },
    daily: {
        time: ['2025-01-01', '2025-01-02', '2025-01-03'],
        weather_code: [2, 0, 61],
        temperature_2m_max: [25, 28, 20],
        temperature_2m_min: [15, 18, 12],
        wind_speed_10m_max: [15, 10, 20],
    },
    hourly: {
        time: ['2025-01-01T00:00', '2025-01-01T01:00', '2025-01-02T00:00'],
        wind_speed_10m: [10, 12, 8],
        wind_direction_10m: [180, 190, 270],
    },
};

const mockUVXml = `<?xml version="1.0"?>
<stations>
    <location id="Melbourne">
        <index>6.2</index>
        <time>12:30</time>
    </location>
    <location id="Sydney">
        <index>7.1</index>
        <time>12:35</time>
    </location>
</stations>`;

function setupMockFetch(weatherData = mockWeatherResponse, uvXml = mockUVXml) {
    mockFetch.mockImplementation((url: string) => {
        if (url.includes('open-meteo.com')) {
            return Promise.resolve({
                ok: true,
                json: () => Promise.resolve(weatherData),
            });
        }
        if (url.includes('arpansa.gov.au')) {
            return Promise.resolve({
                ok: true,
                text: () => Promise.resolve(uvXml),
            });
        }
        return Promise.reject(new Error(`Unexpected URL: ${url}`));
    });
}

describe('LOCATIONS', () => {
    it('contains port_melbourne', () => {
        expect(LOCATIONS['port_melbourne']).toBeDefined();
        expect(LOCATIONS['port_melbourne'].name).toBe('Port Melbourne, Australia');
    });

    it('contains sydney', () => {
        expect(LOCATIONS['sydney']).toBeDefined();
        expect(LOCATIONS['sydney'].name).toBe('Sydney, Australia');
    });

    it('contains hong_kong', () => {
        expect(LOCATIONS['hong_kong']).toBeDefined();
        expect(LOCATIONS['hong_kong'].name).toBe('Hong Kong');
    });
});

describe('loadWeather', () => {
    beforeEach(() => {
        mockFetch.mockReset();
    });

    it('loads weather for a predefined location', async () => {
        setupMockFetch();
        const data = await loadWeather('port_melbourne');

        expect(data.error).toBeNull();
        expect(data.location).toBe('Port Melbourne, Australia');
        expect(data.temperature).toBe(22.5);
        expect(data.condition).toBe('Partly cloudy');
        expect(data.humidity).toBe(65);
        expect(data.cloudCover).toBe(40);
        expect(data.windSpeed).toBe(12.3);
        expect(data.windDirection).toBe(180);
        expect(data.windDirectionDesc).toBe('S');
        expect(data.fetchedAt).toBeTruthy();
    });

    it('includes forecast data', async () => {
        setupMockFetch();
        const data = await loadWeather('port_melbourne');

        expect(data.forecast).toHaveLength(3);
        expect(data.forecast![0].name).toBe('Today');
        expect(data.forecast![0].high).toBe(25);
        expect(data.forecast![0].low).toBe(15);
    });

    it('includes hourly data in dailyHourlyMap', async () => {
        setupMockFetch();
        const data = await loadWeather('port_melbourne');

        expect(data.dailyHourlyMap).toBeTruthy();
        expect(data.dailyHourlyMap!['2025-01-01']).toHaveLength(2);
        expect(data.dailyHourlyMap!['2025-01-02']).toHaveLength(1);
    });

    it('uses ARPANSA UV data for Melbourne', async () => {
        setupMockFetch();
        const data = await loadWeather('port_melbourne');

        // ARPANSA Melbourne UV (6.2) should override Open-Meteo UV (5.2)
        expect(data.uvIndex).toBe(6.2);
        expect(data.uvTime).toBe('12:30');
    });

    it('uses ARPANSA UV data for Sydney', async () => {
        setupMockFetch();
        const data = await loadWeather('sydney');

        expect(data.uvIndex).toBe(7.1);
        expect(data.uvTime).toBe('12:35');
    });

    it('falls back to Open-Meteo UV for Hong Kong (no ARPANSA)', async () => {
        setupMockFetch();
        const data = await loadWeather('hong_kong');

        expect(data.uvIndex).toBe(5.2);
        expect(data.uvTime).toBeNull();
    });

    it('handles custom lat/lon', async () => {
        setupMockFetch();
        const data = await loadWeather('ignored', '40.7128', '-74.0060');

        expect(data.location).toBe('Current Location');
        expect(data.error).toBeNull();

        // Verify fetch was called with custom coordinates
        const weatherCall = mockFetch.mock.calls.find((c: any[]) => c[0].includes('open-meteo'));
        expect(weatherCall![0]).toContain('latitude=40.7128');
        expect(weatherCall![0]).toContain('longitude=-74.0060');
    });

    it('falls back to port_melbourne for unknown location key', async () => {
        setupMockFetch();
        const data = await loadWeather('unknown_city');

        expect(data.location).toBe('Port Melbourne, Australia');
        expect(data.error).toBeNull();
    });

    it('returns error data when fetch fails', { timeout: 15000 }, async () => {
        mockFetch.mockRejectedValue(new Error('Network error'));
        const data = await loadWeather('port_melbourne');

        expect(data.error).toContain('Network error');
        expect(data.temperature).toBeNull();
        expect(data.forecast).toBeNull();
        expect(data.fetchedAt).toBeNull();
    });

    it('handles UV fetch failure gracefully (falls back to Open-Meteo UV)', async () => {
        mockFetch.mockImplementation((url: string) => {
            if (url.includes('open-meteo.com')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(mockWeatherResponse),
                });
            }
            if (url.includes('arpansa.gov.au')) {
                return Promise.reject(new Error('UV service down'));
            }
            return Promise.reject(new Error(`Unexpected URL: ${url}`));
        });

        const data = await loadWeather('port_melbourne');

        // Should still work but fall back to Open-Meteo UV
        expect(data.error).toBeNull();
        expect(data.uvIndex).toBe(5.2); // Open-Meteo fallback
    });

    it('handles empty weather response', async () => {
        setupMockFetch({
            timezone: 'Australia/Melbourne',
            current: {},
            daily: {},
            hourly: {},
        } as any);

        const data = await loadWeather('port_melbourne');

        expect(data.error).toBeNull();
        expect(data.temperature).toBe('N/A');
        expect(data.windSpeed).toBe('N/A');
        expect(data.forecast).toEqual([]);
    });

    it('wind direction converts to compass correctly', async () => {
        const customResponse = {
            ...mockWeatherResponse,
            current: { ...mockWeatherResponse.current, wind_direction_10m: 0 },
        };
        setupMockFetch(customResponse);
        const data = await loadWeather('port_melbourne');
        expect(data.windDirectionDesc).toBe('N');
    });
});
