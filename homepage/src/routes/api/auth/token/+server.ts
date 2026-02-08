import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

const isMockMode = import.meta.env.VITE_DEV_MODE === 'mock';

// Mock implementation
const mockHandler: RequestHandler = async () => {
    // Simulate network delay
    await new Promise(resolve => setTimeout(resolve, 200));

    // Mock JWT token response (similar to Keycloak structure)
    const mockToken = {
        access_token: 'mock-jwt-token-' + Date.now(),
        expires_in: 3600,
        refresh_expires_in: 7200,
        refresh_token: 'mock-refresh-token-' + Date.now(),
        token_type: 'Bearer',
        'not-before-policy': 0,
        session_state: 'mock-session-' + Date.now(),
        scope: 'openid profile email'
    };

    console.log('[Auth Proxy] Mock mode: Returning mock token');

    return json(mockToken, {
        status: 200,
        headers: {
            'Cache-Control': 'no-store',
        }
    });
};

// Production implementation
// Proxy token requests to Keycloak to avoid CORS issues
const productionHandler: RequestHandler = async ({ request }) => {
    try {
        const body = await request.text();

        const keycloakUrl = 'https://auth.johnsonyuen.com';
        const realm = 'homekube';
        const tokenUrl = `${keycloakUrl}/realms/${realm}/protocol/openid-connect/token`;

        console.log('[Auth Proxy] Forwarding token request to:', tokenUrl);

        const response = await fetch(tokenUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: body,
        });

        const responseText = await response.text();

        console.log('[Auth Proxy] Response status:', response.status);

        // Try to parse as JSON
        let responseData;
        try {
            responseData = JSON.parse(responseText);
        } catch {
            responseData = { error: 'Invalid response', details: responseText };
        }

        return json(responseData, {
            status: response.status,
            headers: {
                'Cache-Control': 'no-store',
            }
        });
    } catch (e) {
        console.error('[Auth Proxy] Error:', e);
        return json({ error: 'Token proxy failed', details: String(e) }, { status: 500 });
    }
};

export const POST = isMockMode ? mockHandler : productionHandler;
