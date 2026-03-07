export interface LatLng {
  lat: number;
  lng: number;
}

export interface LocationReport {
  memberId: string;
  lat: number;
  lng: number;
  accuracy: number;
  altitude: number | null;
  speed: number | null;
  bearing: number | null;
  battery: number | null;
  timestamp: string;
}

export interface MemberLocation {
  memberId: string;
  displayName: string;
  avatarUrl: string | null;
  lat: number;
  lng: number;
  accuracy: number;
  altitude: number | null;
  speed: number | null;
  bearing: number | null;
  battery: number | null;
  timestamp: string;
  isOnline: boolean;
}

export interface Place {
  id: string;
  name: string;
  lat: number;
  lng: number;
  radiusMeters: number;
  icon: string;
  createdBy: string;
  createdAt: string;
}

export interface PlaceCreate {
  name: string;
  lat: number;
  lng: number;
  radiusMeters: number;
  icon: string;
}

export interface PlaceUpdate {
  name?: string;
  lat?: number;
  lng?: number;
  radiusMeters?: number;
  icon?: string;
}

export interface HistoryQuery {
  memberId: string;
  date: string;
}

export interface HistoryPoint {
  lat: number;
  lng: number;
  accuracy: number;
  speed: number | null;
  timestamp: string;
}

export interface FamilyGroup {
  id: string;
  name: string;
  members: FamilyMember[];
}

export interface FamilyMember {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  role: 'admin' | 'member';
}

export interface LocationApi {
  getFamily(): Promise<FamilyGroup>;
  getFamilyLocations(): Promise<MemberLocation[]>;
  reportLocations(reports: LocationReport[]): Promise<void>;
  getLocationHistory(query: HistoryQuery): Promise<HistoryPoint[]>;
  getPlaces(): Promise<Place[]>;
  createPlace(place: PlaceCreate): Promise<Place>;
  updatePlace(id: string, update: PlaceUpdate): Promise<Place>;
  deletePlace(id: string): Promise<void>;
}
