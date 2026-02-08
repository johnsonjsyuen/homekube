/**
 * MockKeycloak - A mock implementation of keycloak-js for development and testing
 *
 * This class mimics the behavior of the real Keycloak client but always auto-authenticates
 * a mock user without requiring a real Keycloak server.
 */

export interface TokenParsed {
    preferred_username: string;
    realm_access: {
        roles: string[];
    };
    exp?: number;
    iat?: number;
}

export class MockKeycloak {
    authenticated: boolean = false;
    token: string | null = null;
    tokenParsed: TokenParsed | null = null;

    private config: {
        url: string;
        realm: string;
        clientId: string;
    };

    constructor(config: { url: string; realm: string; clientId: string }) {
        this.config = config;
    }

    /**
     * Initialize the mock Keycloak instance.
     * Auto-authenticates as "mockuser" after 300ms to simulate real async behavior.
     */
    async init(initOptions?: {
        onLoad?: string;
        pkceMethod?: string;
        checkLoginIframe?: boolean;
        responseMode?: string;
    }): Promise<boolean> {
        console.log('[MockKeycloak] Initializing with config:', this.config);
        console.log('[MockKeycloak] Init options:', initOptions);

        // Simulate async initialization delay
        await new Promise(resolve => setTimeout(resolve, 300));

        // Auto-authenticate with mock user
        this.authenticated = true;
        this.token = this.generateMockToken();
        this.tokenParsed = {
            preferred_username: 'mockuser',
            realm_access: {
                roles: ['user', 'admin']
            },
            exp: Math.floor(Date.now() / 1000) + 3600, // Expires in 1 hour
            iat: Math.floor(Date.now() / 1000)
        };

        console.log('[MockKeycloak] Auto-authenticated as:', this.tokenParsed.preferred_username);
        console.log('[MockKeycloak] Roles:', this.tokenParsed.realm_access.roles);

        return this.authenticated;
    }

    /**
     * Login - re-authenticate the user
     */
    async login(options?: { redirectUri?: string }): Promise<void> {
        console.log('[MockKeycloak] Login called', options);

        // Simulate login delay
        await new Promise(resolve => setTimeout(resolve, 300));

        // Re-authenticate
        this.authenticated = true;
        this.token = this.generateMockToken();
        this.tokenParsed = {
            preferred_username: 'mockuser',
            realm_access: {
                roles: ['user', 'admin']
            },
            exp: Math.floor(Date.now() / 1000) + 3600, // 1 hour from now
            iat: Math.floor(Date.now() / 1000)
        };

        console.log('[MockKeycloak] Login successful, authenticated as:', this.tokenParsed.preferred_username);
    }

    /**
     * Logout clears the authentication state.
     */
    async logout(options?: { redirectUri?: string }): Promise<void> {
        console.log('[MockKeycloak] Logging out', options);
        this.authenticated = false;
        this.token = null;
        this.tokenParsed = null;

        // In real Keycloak, this would redirect. For mock, we just log it.
        if (options?.redirectUri) {
            console.log('[MockKeycloak] Would redirect to:', options.redirectUri);
        }
    }

    /**
     * Update token refreshes the token timestamp.
     * Returns true if the token was refreshed, false otherwise.
     */
    async updateToken(minValidity: number = 5): Promise<boolean> {
        if (!this.authenticated || !this.tokenParsed) {
            console.log('[MockKeycloak] Cannot update token: not authenticated');
            return false;
        }

        const now = Math.floor(Date.now() / 1000);
        const exp = this.tokenParsed.exp || 0;
        const timeLeft = exp - now;

        console.log('[MockKeycloak] Token time left:', timeLeft, 'seconds');

        // If token expires within minValidity seconds, refresh it
        if (timeLeft < minValidity) {
            console.log('[MockKeycloak] Refreshing token');
            this.token = this.generateMockToken();
            this.tokenParsed = {
                ...this.tokenParsed,
                exp: now + 3600, // New expiration: 1 hour from now
                iat: now
            };
            return true;
        }

        console.log('[MockKeycloak] Token still valid, no refresh needed');
        return false;
    }

    /**
     * Generate a mock JWT token.
     * This is not a real JWT, just a mock string for testing.
     */
    private generateMockToken(): string {
        const timestamp = Date.now();
        return `mock-token-${timestamp}`;
    }
}
