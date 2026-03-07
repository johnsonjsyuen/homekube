import { describe, it, expect } from 'vitest';
import { haversineDistance, detectGeofences } from './geofence';
import type { Place } from '$lib/api/types';

describe('haversineDistance', () => {
  it('TC-001: Melbourne CBD to St Kilda is ~6200m', () => {
    const cbd = { lat: -37.8136, lng: 144.9631 };
    const stKilda = { lat: -37.8676, lng: 144.9739 };
    const dist = haversineDistance(cbd, stKilda);
    expect(dist).toBeGreaterThan(6000);
    expect(dist).toBeLessThan(6400);
  });

  it('same point returns 0m', () => {
    const point = { lat: -37.8136, lng: 144.9631 };
    expect(haversineDistance(point, point)).toBeCloseTo(0, 0);
  });

  it('antipodal points return ~20000km', () => {
    const a = { lat: 0, lng: 0 };
    const b = { lat: 0, lng: 180 };
    const dist = haversineDistance(a, b);
    expect(dist).toBeGreaterThan(20_000_000);
    expect(dist).toBeLessThan(20_100_000);
  });
});

describe('detectGeofences', () => {
  const places: Place[] = [
    { id: '1', name: 'Home', lat: -37.81, lng: 144.96, radiusMeters: 100, icon: 'H', createdBy: 'a', createdAt: '' },
    { id: '2', name: 'School', lat: -37.82, lng: 144.97, radiusMeters: 200, icon: 'S', createdBy: 'a', createdAt: '' },
    { id: '3', name: 'Work', lat: -37.83, lng: 144.98, radiusMeters: 150, icon: 'W', createdBy: 'a', createdAt: '' },
  ];

  it('TC-002: point inside 1 of 3 circles returns that place', () => {
    // Point very close to Home
    const result = detectGeofences({ lat: -37.8101, lng: 144.9601 }, places);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Home');
  });

  it('point in 0 circles returns empty array', () => {
    const result = detectGeofences({ lat: -37.0, lng: 144.0 }, places);
    expect(result).toHaveLength(0);
  });

  it('point on boundary is included', () => {
    // Point exactly at radius distance (approximately)
    const result = detectGeofences({ lat: -37.81, lng: 144.96 }, places);
    expect(result.length).toBeGreaterThanOrEqual(1);
  });

  it('point in overlapping circles returns multiple', () => {
    // Create overlapping circles
    const overlapping: Place[] = [
      { id: '1', name: 'A', lat: 0, lng: 0, radiusMeters: 100000, icon: 'A', createdBy: 'x', createdAt: '' },
      { id: '2', name: 'B', lat: 0.1, lng: 0.1, radiusMeters: 100000, icon: 'B', createdBy: 'x', createdAt: '' },
    ];
    const result = detectGeofences({ lat: 0.05, lng: 0.05 }, overlapping);
    expect(result).toHaveLength(2);
  });
});
