import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

// Proxy token requests to Keycloak to avoid CORS issues
export const POST: RequestHandler = async ({ request }) => {
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
