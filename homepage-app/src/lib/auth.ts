import Keycloak from 'keycloak-js';
import { config } from './config';

let keycloak: Keycloak | null = null;
let initialized = false;

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
        const authenticated = await keycloak.init({
            pkceMethod: 'S256',
            checkLoginIframe: false,
            responseMode: 'query'
        });

        console.log('[Auth] Keycloak init complete. Authenticated:', authenticated);

        initialized = true;
        updateAuthState(keycloak);

        // Clean auth params from URL after successful login redirect
        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.has('code') || urlParams.has('state') || urlParams.has('session_state')) {
            const cleanUrl = new URL(window.location.href);
            cleanUrl.searchParams.delete('code');
            cleanUrl.searchParams.delete('state');
            cleanUrl.searchParams.delete('session_state');
            cleanUrl.searchParams.delete('iss');
            history.replaceState(null, '', cleanUrl.toString());
        }

        // Set up token refresh
        if (authenticated) {
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
        console.log('[Auth] login redirectUri:', redirectUri);
        await keycloak.login({ redirectUri });
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

export async function getFreshToken(): Promise<string | null> {
    if (!keycloak?.authenticated) return null;
    try {
        const refreshed = await keycloak.updateToken(30);
        if (refreshed) {
            updateAuthState(keycloak);
        }
    } catch {
        console.error('[Auth] Failed to refresh token');
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
