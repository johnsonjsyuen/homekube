import type {
  LocationApi,
  FamilyGroup,
  MemberLocation,
  LocationReport,
  HistoryQuery,
  HistoryPoint,
  Place,
  PlaceCreate,
  PlaceUpdate,
} from './types';

// Melbourne CBD center
const CENTER = { lat: -37.8136, lng: 144.9631 };

const FAMILY: FamilyGroup = {
  id: 'family-001',
  name: 'The Yuens',
  members: [
    { id: 'member-dad', displayName: 'Dad', avatarUrl: null, role: 'admin' },
    { id: 'member-mum', displayName: 'Mum', avatarUrl: null, role: 'admin' },
    { id: 'member-alice', displayName: 'Alice', avatarUrl: null, role: 'member' },
    { id: 'member-bob', displayName: 'Bob', avatarUrl: null, role: 'member' },
  ],
};

function randomOffset(range: number): number {
  return (Math.random() - 0.5) * 2 * range;
}

function randomBattery(): number {
  return Math.floor(Math.random() * 60) + 40;
}

// Each member has a "base" position that drifts slightly each call
const memberPositions: Record<string, { lat: number; lng: number }> = {
  'member-dad': { lat: CENTER.lat + 0.005, lng: CENTER.lng + 0.003 },
  'member-mum': { lat: CENTER.lat - 0.003, lng: CENTER.lng - 0.005 },
  'member-alice': { lat: CENTER.lat + 0.01, lng: CENTER.lng - 0.008 },
  'member-bob': { lat: CENTER.lat - 0.008, lng: CENTER.lng + 0.01 },
};

export class MockLocationApi implements LocationApi {
  private places: Place[] = [
    {
      id: 'place-home',
      name: 'Home',
      lat: CENTER.lat + 0.005,
      lng: CENTER.lng + 0.003,
      radiusMeters: 100,
      icon: '\u{1F3E0}',
      createdBy: 'member-dad',
      createdAt: '2026-01-01T00:00:00.000Z',
    },
    {
      id: 'place-school',
      name: 'School',
      lat: CENTER.lat + 0.01,
      lng: CENTER.lng - 0.008,
      radiusMeters: 200,
      icon: '\u{1F3EB}',
      createdBy: 'member-mum',
      createdAt: '2026-01-01T00:00:00.000Z',
    },
    {
      id: 'place-work',
      name: 'Work',
      lat: CENTER.lat - 0.003,
      lng: CENTER.lng - 0.005,
      radiusMeters: 150,
      icon: '\u{1F3E2}',
      createdBy: 'member-dad',
      createdAt: '2026-01-01T00:00:00.000Z',
    },
  ];

  async getFamily(): Promise<FamilyGroup> {
    return FAMILY;
  }

  async getFamilyLocations(): Promise<MemberLocation[]> {
    const now = new Date().toISOString();
    return FAMILY.members.map((m) => {
      const pos = memberPositions[m.id];
      // Drift position slightly
      pos.lat += randomOffset(0.0005);
      pos.lng += randomOffset(0.0005);
      return {
        memberId: m.id,
        displayName: m.displayName,
        avatarUrl: m.avatarUrl,
        lat: pos.lat,
        lng: pos.lng,
        accuracy: Math.random() * 20 + 5,
        altitude: null,
        speed: Math.random() * 5,
        bearing: Math.random() * 360,
        battery: randomBattery(),
        timestamp: now,
        isOnline: true,
      };
    });
  }

  async reportLocations(_reports: LocationReport[]): Promise<void> {
    // No-op in mock
  }

  async getLocationHistory(query: HistoryQuery): Promise<HistoryPoint[]> {
    const memberPos = memberPositions[query.memberId] ?? CENTER;
    const pointCount = 100 + Math.floor(Math.random() * 100);
    const points: HistoryPoint[] = [];
    const dateBase = new Date(query.date + 'T06:00:00.000Z');

    let lat = memberPos.lat;
    let lng = memberPos.lng;

    for (let i = 0; i < pointCount; i++) {
      lat += randomOffset(0.001);
      lng += randomOffset(0.001);
      const time = new Date(dateBase.getTime() + i * 60000 * (16 / pointCount));
      points.push({
        lat,
        lng,
        accuracy: Math.random() * 15 + 5,
        speed: Math.random() * 10,
        timestamp: time.toISOString(),
      });
    }

    return points;
  }

  async getPlaces(): Promise<Place[]> {
    return [...this.places];
  }

  async createPlace(place: PlaceCreate): Promise<Place> {
    const newPlace: Place = {
      ...place,
      id: crypto.randomUUID(),
      createdBy: 'member-dad',
      createdAt: new Date().toISOString(),
    };
    this.places.push(newPlace);
    return newPlace;
  }

  async updatePlace(id: string, update: PlaceUpdate): Promise<Place> {
    const idx = this.places.findIndex((p) => p.id === id);
    if (idx === -1) throw new Error(`Place ${id} not found`);
    this.places[idx] = { ...this.places[idx], ...update };
    return this.places[idx];
  }

  async deletePlace(id: string): Promise<void> {
    this.places = this.places.filter((p) => p.id !== id);
  }
}
