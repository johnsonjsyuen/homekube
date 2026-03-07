import { describe, it, expect } from 'vitest';
import { MockLocationApi } from './mock';

describe('MockLocationApi', () => {
  it('TC-007: getFamilyLocations returns 4 members with valid data', async () => {
    const api = new MockLocationApi();
    const locations = await api.getFamilyLocations();

    expect(locations).toHaveLength(4);
    for (const loc of locations) {
      expect(loc.lat).toBeGreaterThanOrEqual(-90);
      expect(loc.lat).toBeLessThanOrEqual(90);
      expect(loc.lng).toBeGreaterThanOrEqual(-180);
      expect(loc.lng).toBeLessThanOrEqual(180);
      expect(loc.battery).toBeGreaterThanOrEqual(0);
      expect(loc.battery).toBeLessThanOrEqual(100);
      expect(loc.isOnline).toBe(true);
      expect(loc.displayName).toBeTruthy();
    }
  });

  it('getFamilyLocations returns different positions on each call (drift)', async () => {
    const api = new MockLocationApi();
    const first = await api.getFamilyLocations();
    const second = await api.getFamilyLocations();

    // At least one member should have drifted
    const drifted = first.some((f, i) => {
      const s = second[i];
      return f.lat !== s.lat || f.lng !== s.lng;
    });
    expect(drifted).toBe(true);
  });

  it('getFamily returns hardcoded family with 4 members', async () => {
    const api = new MockLocationApi();
    const family = await api.getFamily();

    expect(family.name).toBe('The Yuens');
    expect(family.members).toHaveLength(4);
    expect(family.members.map((m) => m.displayName)).toEqual(['Dad', 'Mum', 'Alice', 'Bob']);
  });

  it('getPlaces returns 3 default places', async () => {
    const api = new MockLocationApi();
    const places = await api.getPlaces();
    expect(places).toHaveLength(3);
    expect(places.map((p) => p.name)).toEqual(['Home', 'School', 'Work']);
  });

  it('createPlace adds and returns new place with id', async () => {
    const api = new MockLocationApi();
    const created = await api.createPlace({
      name: 'Park',
      lat: -37.82,
      lng: 144.97,
      radiusMeters: 300,
      icon: 'P',
    });

    expect(created.id).toBeTruthy();
    expect(created.name).toBe('Park');

    const all = await api.getPlaces();
    expect(all).toHaveLength(4);
  });

  it('updatePlace modifies existing place', async () => {
    const api = new MockLocationApi();
    const places = await api.getPlaces();
    const updated = await api.updatePlace(places[0].id, { name: 'Updated Home' });

    expect(updated.name).toBe('Updated Home');
  });

  it('deletePlace removes place', async () => {
    const api = new MockLocationApi();
    const places = await api.getPlaces();
    await api.deletePlace(places[0].id);

    const remaining = await api.getPlaces();
    expect(remaining).toHaveLength(2);
  });

  it('getLocationHistory generates 100-200 points', async () => {
    const api = new MockLocationApi();
    const history = await api.getLocationHistory({
      memberId: 'member-dad',
      date: '2026-03-08',
    });

    expect(history.length).toBeGreaterThanOrEqual(100);
    expect(history.length).toBeLessThanOrEqual(200);

    for (const point of history) {
      expect(point.lat).toBeDefined();
      expect(point.lng).toBeDefined();
      expect(point.timestamp).toBeTruthy();
    }
  });

  it('reportLocations is a no-op', async () => {
    const api = new MockLocationApi();
    await expect(api.reportLocations([])).resolves.toBeUndefined();
  });
});
