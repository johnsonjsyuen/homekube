import { HttpLocationApi } from './http';
import type { LocationApi } from './types';

export const api: LocationApi = new HttpLocationApi();
