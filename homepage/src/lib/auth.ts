/**
 * Auth module wrapper - conditionally loads real or mock implementation
 */

const isMockMode = import.meta.env.VITE_DEV_MODE === 'mock';

console.log('[AUTH] Mode:', isMockMode ? 'MOCK' : 'PRODUCTION');

// Dynamically import the correct module at runtime
const authModule = isMockMode
    ? await import('./auth.mock')
    : await import('./auth.real');

// Re-export everything from the selected module
export const {
    initKeycloak,
    login,
    logout,
    getToken,
    getFreshToken,
    isAuthenticated,
    getUsername,
    getAuthState,
    onAuthStateChange
} = authModule;

export type { AuthState } from './auth.mock';
