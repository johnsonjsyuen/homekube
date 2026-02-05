import Keycloak from 'keycloak-js';

// Keycloak configuration - these can be overridden by environment variables
const keycloakConfig = {
    url: import.meta.env.VITE_KEYCLOAK_URL || 'http://localhost:8080',
    realm: import.meta.env.VITE_KEYCLOAK_REALM || 'homekube',
    clientId: import.meta.env.VITE_KEYCLOAK_CLIENT_ID || 'homepage'
};

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

    keycloak = new Keycloak(keycloakConfig);

    try {
        const authenticated = await keycloak.init({
            onLoad: 'check-sso',
            silentCheckSsoRedirectUri: window.location.origin + '/silent-check-sso.html',
            pkceMethod: 'S256'
        });

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
        console.error('Keycloak init failed:', error);
        initialized = true; // Mark as initialized even on failure to prevent retries
        return authState;
    }
}

export async function login(): Promise<void> {
    if (!keycloak) {
        await initKeycloak();
    }
    if (keycloak && !keycloak.authenticated) {
        await keycloak.login();
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
