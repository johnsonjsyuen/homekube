import Keycloak from 'keycloak-js';
import { config } from './config';

let keycloak: Keycloak | null = null;
let initialized = false;
let refreshInterval: ReturnType<typeof setInterval> | null = null;

export interface AuthState {
    authenticated: boolean;
    token: string | null;
    username: string | null;
    roles: string[];
}

let authState: AuthState = {
    authenticated: false,
    token: null,
    username: null,
    roles: []
};

type AuthCallback = (state: AuthState) => void;
const callbacks: AuthCallback[] = [];

const TOKEN_STORAGE_KEY = 'kc_token';
const REFRESH_TOKEN_STORAGE_KEY = 'kc_refreshToken';
const ID_TOKEN_STORAGE_KEY = 'kc_idToken';

function saveTokens(kc: Keycloak) {
    if (typeof localStorage === 'undefined') return;
    if (kc.token) localStorage.setItem(TOKEN_STORAGE_KEY, kc.token);
    else localStorage.removeItem(TOKEN_STORAGE_KEY);
    if (kc.refreshToken) localStorage.setItem(REFRESH_TOKEN_STORAGE_KEY, kc.refreshToken);
    else localStorage.removeItem(REFRESH_TOKEN_STORAGE_KEY);
    if (kc.idToken) localStorage.setItem(ID_TOKEN_STORAGE_KEY, kc.idToken);
    else localStorage.removeItem(ID_TOKEN_STORAGE_KEY);
}

function loadTokens(): { token?: string; refreshToken?: string; idToken?: string } | null {
    if (typeof localStorage === 'undefined') return null;
    const token = localStorage.getItem(TOKEN_STORAGE_KEY);
    const refreshToken = localStorage.getItem(REFRESH_TOKEN_STORAGE_KEY);
    const idToken = localStorage.getItem(ID_TOKEN_STORAGE_KEY);
    if (token && refreshToken) {
        return { token, refreshToken, idToken: idToken || undefined };
    }
    return null;
}

function clearTokens() {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem(TOKEN_STORAGE_KEY);
    localStorage.removeItem(REFRESH_TOKEN_STORAGE_KEY);
    localStorage.removeItem(ID_TOKEN_STORAGE_KEY);
}

export function onAuthStateChange(callback: AuthCallback): () => void {
    callbacks.push(callback);
    callback(authState);
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

export async function initKeycloak(): Promise<AuthState> {
    if (initialized && keycloak) {
        return authState;
    }

    const keycloakConfig = {
        url: config.keycloak.url,
        realm: config.keycloak.realm,
        clientId: config.keycloak.clientId
    };

    console.log('[Auth] Initializing Keycloak with config:', keycloakConfig);
    keycloak = new Keycloak(keycloakConfig);

    try {
        // Don't use onLoad: 'check-sso' — Tauri origins may not be registered
        // in Keycloak and the redirect fails with "Invalid parameter: redirect_uri".
        // Instead, just init and process any returning auth code silently.
        const savedTokens = loadTokens();
        const authenticated = await keycloak.init({
            pkceMethod: 'S256',
            checkLoginIframe: false,
            responseMode: 'query',
            ...savedTokens && {
                token: savedTokens.token,
                refreshToken: savedTokens.refreshToken,
                idToken: savedTokens.idToken
            }
        });

        console.log('[Auth] Keycloak init complete. Authenticated:', authenticated);

        initialized = true;

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

        // Clean auth params from URL after successful login redirect
        if (typeof window !== 'undefined') {
            const urlParams = new URLSearchParams(window.location.search);
            if (urlParams.has('code') || urlParams.has('state') || urlParams.has('session_state')) {
                const cleanUrl = new URL(window.location.href);
                cleanUrl.searchParams.delete('code');
                cleanUrl.searchParams.delete('state');
                cleanUrl.searchParams.delete('session_state');
                cleanUrl.searchParams.delete('iss');
                history.replaceState(null, '', cleanUrl.toString());
            }
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
        initialized = true;
        return authState;
    }
}

export async function login(): Promise<void> {
    if (!keycloak) {
        await initKeycloak();
    }
    if (keycloak && !keycloak.authenticated) {
        const redirectUri = window.location.origin + window.location.pathname;
        console.log('[Auth] login redirectUri:', redirectUri, 'origin:', window.location.origin, 'href:', window.location.href);
        try {
            await keycloak.login({ redirectUri });
        } catch (error: any) {
            throw new Error(`Login failed (redirectUri: ${redirectUri}): ${error?.message || error}`);
        }
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
            // Force clear local state even if server logout fails
            authState = { authenticated: false, token: null, username: null, roles: [] };
            notifyCallbacks();
        }
    }
}

export function getToken(): string | null {
    return authState.token;
}

export async function getFreshToken(): Promise<string | null> {
    if (!keycloak?.authenticated) return null;
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
