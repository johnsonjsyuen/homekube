/**
 * auth.mock.ts - Drop-in replacement for auth.ts using MockKeycloak
 *
 * This file provides the same AuthState interface and functions as auth.ts
 * but uses MockKeycloak instead of the real Keycloak client.
 *
 * To use this in development:
 * 1. Import from './lib/auth.mock' instead of './lib/auth'
 * 2. All functionality remains the same, but no real Keycloak server is needed
 */

import { MockKeycloak } from './mocks/keycloak';

console.log('[AUTH] Loading auth.mock.ts - Mock authentication enabled');

let keycloak: MockKeycloak | null = null;
let initialized = false;
let refreshInterval: number | null = null;

export interface AuthState {
    authenticated: boolean;
    token: string | null;
    username: string | null;
    roles: string[];
}

// Reactive state for auth
let authState: AuthState = {
    authenticated: false,
    token: null,
    username: null,
    roles: []
};

// Callbacks for state changes
type AuthCallback = (state: AuthState) => void;
const callbacks: AuthCallback[] = [];

export function onAuthStateChange(callback: AuthCallback): () => void {
    callbacks.push(callback);
    // Immediately call with current state
    callback(authState);
    // Return unsubscribe function
    return () => {
        const index = callbacks.indexOf(callback);
        if (index > -1) callbacks.splice(index, 1);
    };
}

function notifyCallbacks() {
    callbacks.forEach(cb => cb(authState));
}

function updateAuthState(kc: MockKeycloak) {
    authState = {
        authenticated: kc.authenticated || false,
        token: kc.token || null,
        username: kc.tokenParsed?.preferred_username || null,
        roles: kc.tokenParsed?.realm_access?.roles || []
    };
    notifyCallbacks();
}

export async function initKeycloak(): Promise<AuthState> {
    if (typeof window === 'undefined') {
        // Server-side, return unauthenticated state
        return authState;
    }

    if (initialized && keycloak) {
        return authState;
    }

    // Mock configuration
    const config = {
        url: 'http://localhost:8080',
        realm: 'homekube',
        clientId: 'homepage'
    };

    console.log('[Auth Mock] Initializing MockKeycloak with config:', config);
    keycloak = new MockKeycloak(config);

    try {
        console.log('[Auth Mock] Starting MockKeycloak init...');

        const authenticated = await keycloak.init({
            onLoad: 'check-sso',
            pkceMethod: 'S256',
            checkLoginIframe: false,
            responseMode: 'query'
        });

        console.log('[Auth Mock] MockKeycloak init complete. Authenticated:', authenticated);
        console.log('[Auth Mock] Token:', keycloak.token ? 'present' : 'missing');
        console.log('[Auth Mock] Token parsed:', keycloak.tokenParsed);

        initialized = true;
        updateAuthState(keycloak);

        // Set up token refresh
        if (refreshInterval) clearInterval(refreshInterval);
        refreshInterval = setInterval(async () => {
            if (keycloak?.authenticated) {
                try {
                    const refreshed = await keycloak.updateToken(60);
                    if (refreshed) {
                        updateAuthState(keycloak);
                    }
                } catch {
                    console.error('[Auth Mock] Failed to refresh token');
                    await logout();
                }
            }
        }, 30000) as unknown as number;

        return authState;
    } catch (error) {
        console.error('[Auth Mock] MockKeycloak init failed:', error);
        initialized = true; // Mark as initialized even on failure to prevent retries
        return authState;
    }
}

export async function login(redirectPath?: string): Promise<void> {
    if (!keycloak) {
        await initKeycloak();
    }
    if (keycloak && !keycloak.authenticated) {
        // Use provided redirect path or current URL
        const redirectUri = redirectPath
            ? window.location.origin + redirectPath
            : window.location.href;
        await keycloak.login({ redirectUri });

        // Update auth state after login
        if (keycloak) {
            updateAuthState(keycloak);
        }
    }
}

export async function logout(): Promise<void> {
    // Clean up refresh interval
    if (refreshInterval) {
        clearInterval(refreshInterval);
        refreshInterval = null;
    }

    if (keycloak?.authenticated) {
        await keycloak.logout({ redirectUri: window.location.origin });
    }

    // Update state after logout
    if (keycloak) {
        updateAuthState(keycloak);
    }
}

export function getToken(): string | null {
    return authState.token;
}

/**
 * Get a fresh token, refreshing if necessary.
 * Use this before making new connections (e.g. WebSocket).
 */
export async function getFreshToken(): Promise<string | null> {
    if (!keycloak?.authenticated) return null;
    try {
        const refreshed = await keycloak.updateToken(30);
        if (refreshed) {
            updateAuthState(keycloak);
        }
    } catch {
        console.error('[Auth Mock] Failed to refresh token');
        return null;
    }
    return keycloak.token || null;
}

export function isAuthenticated(): boolean {
    return authState.authenticated;
}

export function getUsername(): string | null {
    return authState.username;
}

export function getAuthState(): AuthState {
    return authState;
}
