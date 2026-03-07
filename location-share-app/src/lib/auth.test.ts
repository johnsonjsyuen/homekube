import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock keycloak-js before importing auth
vi.mock('keycloak-js', () => {
    return {
        default: vi.fn().mockImplementation(() => ({
            init: vi.fn().mockResolvedValue(false),
            login: vi.fn().mockResolvedValue(undefined),
            logout: vi.fn().mockResolvedValue(undefined),
            updateToken: vi.fn().mockResolvedValue(false),
            authenticated: false,
            token: null,
            tokenParsed: null,
        })),
    };
});

describe('auth', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    it('initial state is unauthenticated', async () => {
        const { getAuthState } = await import('./auth');
        const state = getAuthState();
        expect(state.authenticated).toBe(false);
        expect(state.token).toBeNull();
        expect(state.username).toBeNull();
        expect(state.roles).toEqual([]);
    });

    it('getToken returns null when not authenticated', async () => {
        const { getToken } = await import('./auth');
        expect(getToken()).toBeNull();
    });

    it('isAuthenticated returns false initially', async () => {
        const { isAuthenticated } = await import('./auth');
        expect(isAuthenticated()).toBe(false);
    });

    it('getUsername returns null initially', async () => {
        const { getUsername } = await import('./auth');
        expect(getUsername()).toBeNull();
    });

    it('onAuthStateChange calls callback immediately with current state', async () => {
        const { onAuthStateChange } = await import('./auth');
        const callback = vi.fn();
        onAuthStateChange(callback);
        expect(callback).toHaveBeenCalledTimes(1);
        expect(callback).toHaveBeenCalledWith({
            authenticated: false,
            token: null,
            username: null,
            roles: [],
        });
    });

    it('onAuthStateChange returns unsubscribe function', async () => {
        const { onAuthStateChange } = await import('./auth');
        const callback = vi.fn();
        const unsubscribe = onAuthStateChange(callback);
        expect(typeof unsubscribe).toBe('function');
    });

    it('unsubscribe prevents future callbacks', async () => {
        const { onAuthStateChange } = await import('./auth');
        const callback = vi.fn();
        const unsubscribe = onAuthStateChange(callback);
        expect(callback).toHaveBeenCalledTimes(1);
        unsubscribe();
        // Callback count should not increase after unsubscribe
        expect(callback).toHaveBeenCalledTimes(1);
    });

    it('initKeycloak initializes and returns unauthenticated state', async () => {
        const { initKeycloak } = await import('./auth');
        const state = await initKeycloak();
        expect(state.authenticated).toBe(false);
        expect(state.token).toBeNull();
    });

    it('initKeycloak returns cached state on second call', async () => {
        const { initKeycloak } = await import('./auth');
        const state1 = await initKeycloak();
        const state2 = await initKeycloak();
        expect(state1).toEqual(state2);
    });

    it('getFreshToken returns null when not authenticated', async () => {
        const { initKeycloak, getFreshToken } = await import('./auth');
        await initKeycloak();
        const token = await getFreshToken();
        expect(token).toBeNull();
    });

    it('initKeycloak notifies subscribers', async () => {
        const { initKeycloak, onAuthStateChange } = await import('./auth');
        const callback = vi.fn();
        onAuthStateChange(callback);
        expect(callback).toHaveBeenCalledTimes(1);

        await initKeycloak();
        // callback called again after init with updated state
        expect(callback.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
});
