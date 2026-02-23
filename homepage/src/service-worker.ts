/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />

import { build, files, version } from '$service-worker';

const sw = globalThis as unknown as ServiceWorkerGlobalScope;

// Cache names - static is versioned (immutable hashed assets), data/fonts persist across deploys
const STATIC_CACHE = `static-cache-${version}`;
const FONT_CACHE = 'google-fonts-v1';
const DATA_CACHE = 'weather-data-v1';

// All immutable build + static assets
const STATIC_ASSETS = new Set([...build, ...files]);

// Weather locations to prefetch in background
const WEATHER_LOCATIONS = ['port_melbourne', 'sydney', 'hong_kong'];

// ===========================
// INSTALL: Precache all build + static assets
// ===========================
sw.addEventListener('install', (event) => {
	event.waitUntil(
		(async () => {
			const cache = await caches.open(STATIC_CACHE);
			await cache.addAll([...build, ...files]);
			await sw.skipWaiting();
		})()
	);
});

// ===========================
// ACTIVATE: Clean old caches, prefetch weather
// ===========================
sw.addEventListener('activate', (event) => {
	event.waitUntil(
		(async () => {
			const keys = await caches.keys();
			await Promise.all(
				keys
					.filter((key) => key !== STATIC_CACHE && key !== FONT_CACHE && key !== DATA_CACHE)
					.map((key) => caches.delete(key))
			);
			await sw.clients.claim();
			// Fire-and-forget weather prefetch
			prefetchAllWeatherData();
		})()
	);
});

// ===========================
// FETCH: Route to appropriate caching strategy
// ===========================
sw.addEventListener('fetch', (event) => {
	const { request } = event;
	if (request.method !== 'GET') return;

	const url = new URL(request.url);

	// Static build assets: cache-first (immutable, hashed filenames)
	if (STATIC_ASSETS.has(url.pathname)) {
		event.respondWith(cacheFirst(request, STATIC_CACHE));
		return;
	}

	// Google Fonts: cache-first in a persistent cache
	if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
		event.respondWith(cacheFirst(request, FONT_CACHE));
		return;
	}

	// API routes: never cache (auth tokens, TTS are side-effectful)
	if (url.pathname.startsWith('/api/')) {
		return;
	}

	// Auth redirects: don't cache pages with Keycloak auth params
	if (url.searchParams.has('code') && url.searchParams.has('state')) {
		return;
	}

	// SvelteKit data endpoints (__data.json): network-first with normalized URL
	if (url.pathname.endsWith('__data.json')) {
		event.respondWith(networkFirstData(request, url));
		return;
	}

	// Navigation requests: network-first with cache fallback
	if (request.mode === 'navigate') {
		event.respondWith(networkFirst(request, DATA_CACHE));
		return;
	}
});

// ===========================
// MESSAGE: Handle client messages
// ===========================
sw.addEventListener('message', (event) => {
	if (event.data?.type === 'PREFETCH_WEATHER') {
		event.waitUntil(prefetchAllWeatherData());
	}
});

// ===========================
// Caching Strategies
// ===========================

async function cacheFirst(request: Request, cacheName: string): Promise<Response> {
	const cache = await caches.open(cacheName);
	const cached = await cache.match(request);
	if (cached) return cached;

	try {
		const response = await fetch(request);
		if (response.ok) {
			cache.put(request, response.clone());
		}
		return response;
	} catch {
		return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
	}
}

async function networkFirst(request: Request, cacheName: string): Promise<Response> {
	const cache = await caches.open(cacheName);

	try {
		const response = await fetch(request);
		if (response.ok) {
			cache.put(request, response.clone());
			return response;
		}
		// Non-ok response: try cache before returning the error
		const cached = await cache.match(request);
		return cached ?? response;
	} catch {
		const cached = await cache.match(request);
		if (cached) return cached;
		return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
	}
}

/**
 * Network-first for SvelteKit __data.json requests.
 * Normalizes URL by stripping x-sveltekit-invalidated param so that
 * prefetched entries match runtime navigation requests.
 */
async function networkFirstData(request: Request, url: URL): Promise<Response> {
	const cache = await caches.open(DATA_CACHE);
	const normalizedUrl = normalizeDataUrl(url);

	try {
		const response = await fetch(request);
		if (response.ok) {
			cache.put(normalizedUrl, response.clone());
			return response;
		}
		const cached = await cache.match(normalizedUrl);
		return cached ?? response;
	} catch {
		const cached = await cache.match(normalizedUrl);
		if (cached) return cached;
		return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
	}
}

/**
 * Strip SvelteKit-internal query params so prefetched and runtime URLs
 * resolve to the same cache key.
 */
function normalizeDataUrl(url: URL): string {
	const normalized = new URL(url.toString());
	normalized.searchParams.delete('x-sveltekit-invalidated');
	return normalized.toString();
}

// ===========================
// Weather Prefetch
// ===========================

async function prefetchAllWeatherData(): Promise<void> {
	const cache = await caches.open(DATA_CACHE);

	await Promise.all(
		WEATHER_LOCATIONS.map(async (location) => {
			try {
				const url = new URL(`/__data.json?location=${location}`, sw.location.origin);
				const normalizedKey = normalizeDataUrl(url);
				const response = await fetch(url);
				if (response.ok) {
					await cache.put(normalizedKey, response.clone());
				}
			} catch (err) {
				console.warn(`[SW] Failed to prefetch weather for ${location}:`, err);
			}
		})
	);
}
