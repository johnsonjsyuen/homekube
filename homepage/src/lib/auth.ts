import Keycloak from 'keycloak-js';

// Determine Keycloak URL based on current hostname
function getKeycloakUrl(): string {
    if (typeof window === 'undefined') {
        return 'https://auth.johnsonyuen.com'; // SSR fallback
    }

    // Check for explicit override first (at runtime)
    const envUrl = import.meta.env.VITE_KEYCLOAK_URL;
    if (envUrl) {
        console.log('[Auth] Using VITE_KEYCLOAK_URL:', envUrl);
        return envUrl;
    }

    // Production: use auth.johnsonyuen.com
    const url = 'https://auth.johnsonyuen.com';
    console.log('[Auth] Using default Keycloak URL:', url);
    return url;
}

// Keycloak configuration - evaluated lazily to ensure window is available
function getKeycloakConfig() {
    return {
        url: getKeycloakUrl(),
        realm: import.meta.env.VITE_KEYCLOAK_REALM || 'homekube',
        clientId: import.meta.env.VITE_KEYCLOAK_CLIENT_ID || 'homepage'
    };
}

// Intercept fetch calls to Keycloak token endpoint and proxy through our backend
function setupTokenProxy() {
    if (typeof window === 'undefined') return;

    const originalFetch = window.fetch;
    window.fetch = async function (input: RequestInfo | URL, init?: RequestInit) {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

        // Check if this is a token request to Keycloak
        if (url.includes('auth.johnsonyuen.com') && url.includes('/token')) {
            console.log('[Auth] Intercepting token request, proxying through backend');

            // Proxy through our backend
            return originalFetch('/api/auth/token', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: init?.body,
            });
        }

        // Pass through all other requests
        return originalFetch(input, init);
    };
}

let keycloak: Keycloak | null = null;
let initPromise: Promise<AuthState> | null = null;
let tokenProxySetup = false;
let refreshInterval: ReturnType<typeof setInterval> | null = null;

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

const TOKEN_STORAGE_KEY = 'kc_token';
const REFRESH_TOKEN_STORAGE_KEY = 'kc_refreshToken';
const ID_TOKEN_STORAGE_KEY = 'kc_idToken';

function saveTokens(kc: Keycloak) {
    if (typeof window === 'undefined') return;
    if (kc.token) sessionStorage.setItem(TOKEN_STORAGE_KEY, kc.token);
    else sessionStorage.removeItem(TOKEN_STORAGE_KEY);
    if (kc.refreshToken) sessionStorage.setItem(REFRESH_TOKEN_STORAGE_KEY, kc.refreshToken);
    else sessionStorage.removeItem(REFRESH_TOKEN_STORAGE_KEY);
    if (kc.idToken) sessionStorage.setItem(ID_TOKEN_STORAGE_KEY, kc.idToken);
    else sessionStorage.removeItem(ID_TOKEN_STORAGE_KEY);
}

function loadTokens(): { token?: string; refreshToken?: string; idToken?: string } | null {
    if (typeof window === 'undefined') return null;
    const token = sessionStorage.getItem(TOKEN_STORAGE_KEY);
    const refreshToken = sessionStorage.getItem(REFRESH_TOKEN_STORAGE_KEY);
    const idToken = sessionStorage.getItem(ID_TOKEN_STORAGE_KEY);
    if (token && refreshToken) {
        return { token, refreshToken, idToken: idToken || undefined };
    }
    return null;
}

function clearTokens() {
    if (typeof window === 'undefined') return;
    sessionStorage.removeItem(TOKEN_STORAGE_KEY);
    sessionStorage.removeItem(REFRESH_TOKEN_STORAGE_KEY);
    sessionStorage.removeItem(ID_TOKEN_STORAGE_KEY);
}

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

function updateAuthState(kc: Keycloak) {
    authState = {
        authenticated: kc.authenticated || false,
        token: kc.token || null,
        username: kc.tokenParsed?.preferred_username || null,
        roles: kc.tokenParsed?.realm_access?.roles || []
    };
    saveTokens(kc);
    notifyCallbacks();
}

export function initKeycloak(): Promise<AuthState> {
    if (typeof window === 'undefined') {
        return Promise.resolve(authState);
    }

    // Return existing promise if init is already in progress or completed
    if (initPromise) return initPromise;

    initPromise = doInitKeycloak();
    return initPromise;
}

async function doInitKeycloak(): Promise<AuthState> {
    // In Cypress tests, mock authentication since there's no Keycloak server
    if ((window as any).Cypress) {
        console.log('[Auth] Cypress detected, using mock auth');
        authState = {
            authenticated: true,
            token: 'cypress-test-token',
            username: 'test_user',
            roles: ['user']
        };
        notifyCallbacks();
        return authState;
    }

    // Setup fetch proxy once to avoid CORS issues with token endpoint
    if (!tokenProxySetup) {
        setupTokenProxy();
        tokenProxySetup = true;
    }

    const config = getKeycloakConfig();
    keycloak = new Keycloak(config);

    // Check if we're returning from a login redirect
    const urlParams = new URLSearchParams(window.location.search);
    const hasAuthCode = urlParams.has('code') && urlParams.has('state');

    try {
        // Temporarily bypass SvelteKit's patched replaceState during init.
        // Keycloak calls replaceState to clean auth params from the URL after
        // processing the code. SvelteKit intercepts replaceState and triggers
        // a navigation, which can cause a reload loop.
        const patchedReplaceState = history.replaceState;
        if (hasAuthCode) {
            history.replaceState = History.prototype.replaceState.bind(history);
        }

        const savedTokens = loadTokens();
        const authenticated = await keycloak.init({
            onLoad: 'check-sso',
            pkceMethod: 'S256',
            silentCheckSsoRedirectUri: window.location.origin + '/silent-check-sso.html',
            checkLoginIframe: false,
            responseMode: 'query',
            ...savedTokens && {
                token: savedTokens.token,
                refreshToken: savedTokens.refreshToken,
                idToken: savedTokens.idToken
            }
        });

        // Restore SvelteKit's patched replaceState
        if (hasAuthCode) {
            history.replaceState = patchedReplaceState;
        }

        // If restored from saved tokens, force an immediate refresh
        if (authenticated && savedTokens) {
            try {
                // Force token refresh: -1 means "refresh if expiring within -1 seconds", which is always true
                await keycloak.updateToken(-1);
            } catch {
                console.warn('[Auth] Saved tokens expired, clearing');
                updateAuthState(keycloak);
                clearTokens();
                return authState;
            }
        }

        updateAuthState(keycloak);

        // If we had auth params, the URL was cleaned by Keycloak using the
        // native replaceState (bypassing SvelteKit). Now sync SvelteKit's
        // internal state by doing a replaceState with the current (clean) URL.
        if (hasAuthCode) {
            history.replaceState(history.state, '', window.location.href);
        }

        // Set up token refresh
        if (authenticated) {
            refreshInterval = setInterval(async () => {
                if (keycloak?.authenticated) {
                    try {
                        const refreshed = await keycloak.updateToken(60);
                        if (refreshed) {
                            updateAuthState(keycloak);
                        }
                    } catch {
                        console.error('Failed to refresh token');
                        clearTokens();
                        await logout();
                    }
                }
            }, 30000);
        }

        return authState;
    } catch (error) {
        console.error('[Auth] Keycloak init failed:', error);
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
    }
}

export async function logout(): Promise<void> {
    clearTokens();
    if (refreshInterval) { clearInterval(refreshInterval); refreshInterval = null; }
    if (keycloak?.authenticated) {
        const redirectUri = window.location.origin;
        console.log('[Auth] Logging out, redirectUri:', redirectUri);
        try {
            await keycloak.logout({ redirectUri });
        } catch (error: any) {
            console.error('[Auth] Logout failed:', error?.message || error);
            authState = { authenticated: false, token: null, username: null, roles: [] };
            notifyCallbacks();
        }
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
    // In mock auth (e.g. Cypress), keycloak is null but authState has a token
    if (!keycloak?.authenticated) return authState.token;
    try {
        const refreshed = await keycloak.updateToken(30);
        if (refreshed) {
            updateAuthState(keycloak);
        }
    } catch {
        console.error('[Auth] Failed to refresh token');
        clearTokens();
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
