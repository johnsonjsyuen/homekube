import { MockLocationApi } from './mock';
import type { LocationApi } from './types';

export const api: LocationApi = new MockLocationApi();
