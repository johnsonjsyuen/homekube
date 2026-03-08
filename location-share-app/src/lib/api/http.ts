import { config } from '$lib/config';
import { getFreshToken } from '$lib/auth';
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

const BASE = () => `${config.location.baseUrl}/api`;

async function authHeaders(): Promise<Record<string, string>> {
  const token = await getFreshToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE()}${path}`, {
    method,
    headers: await authHeaders(),
    body: body != null ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${method} ${path} failed (${res.status}): ${text}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export class HttpLocationApi implements LocationApi {
  getFamily(): Promise<FamilyGroup> {
    return request('GET', '/family');
  }

  getFamilyLocations(): Promise<MemberLocation[]> {
    return request('GET', '/family/locations');
  }

  reportLocations(reports: LocationReport[]): Promise<void> {
    return request('POST', '/locations', reports);
  }

  getLocationHistory(query: HistoryQuery): Promise<HistoryPoint[]> {
    const params = new URLSearchParams({ memberId: query.memberId, date: query.date });
    return request('GET', `/locations/history?${params}`);
  }

  getPlaces(): Promise<Place[]> {
    return request('GET', '/places');
  }

  createPlace(place: PlaceCreate): Promise<Place> {
    return request('POST', '/places', place);
  }

  updatePlace(id: string, update: PlaceUpdate): Promise<Place> {
    return request('PUT', `/places/${id}`, update);
  }

  deletePlace(id: string): Promise<void> {
    return request('DELETE', `/places/${id}`);
  }
}
