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
let initialized = false;

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

function updateAuthState(kc: Keycloak) {
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

    // Setup fetch proxy to avoid CORS issues with token endpoint
    setupTokenProxy();

    const config = getKeycloakConfig();
    console.log('[Auth] Initializing Keycloak with config:', config);
    keycloak = new Keycloak(config);

    try {
        console.log('[Auth] Starting Keycloak init...');
        console.log('[Auth] Current URL:', window.location.href);

        // Check if we're returning from a login redirect (URL has code parameter)
        const urlParams = new URLSearchParams(window.location.search);
        const hasAuthCode = urlParams.has('code') && urlParams.has('state');
        console.log('[Auth] Has auth code in URL:', hasAuthCode);

        const authenticated = await keycloak.init({
            onLoad: 'check-sso',
            pkceMethod: 'S256',
            checkLoginIframe: false,  // Disable iframe check which can cause CORS issues
            responseMode: 'query'     // Use query params instead of fragment for better compatibility
        });

        console.log('[Auth] Keycloak init complete. Authenticated:', authenticated);
        console.log('[Auth] Token:', keycloak.token ? 'present' : 'missing');
        console.log('[Auth] Token parsed:', keycloak.tokenParsed);

        initialized = true;
        updateAuthState(keycloak);

        // Set up token refresh
        setInterval(async () => {
            if (keycloak?.authenticated) {
                try {
                    const refreshed = await keycloak.updateToken(60);
                    if (refreshed) {
                        updateAuthState(keycloak);
                    }
                } catch {
                    console.error('Failed to refresh token');
                    await logout();
                }
            }
        }, 30000);

        return authState;
    } catch (error) {
        console.error('[Auth] Keycloak init failed:', error);
        initialized = true; // Mark as initialized even on failure to prevent retries
        return authState;
    }
}

export async function login(): Promise<void> {
    if (!keycloak) {
        await initKeycloak();
    }
    if (keycloak && !keycloak.authenticated) {
        await keycloak.login({
            redirectUri: window.location.origin + window.location.pathname
        });
    }
}

export async function logout(): Promise<void> {
    if (keycloak?.authenticated) {
        await keycloak.logout({ redirectUri: window.location.origin });
    }
}

export function getToken(): string | null {
    return authState.token;
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
