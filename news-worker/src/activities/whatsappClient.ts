const KEYCLOAK_URL = process.env.KEYCLOAK_URL || 'http://keycloak.keycloak.svc.cluster.local';
const KEYCLOAK_REALM = process.env.KEYCLOAK_REALM || 'homekube';
const KEYCLOAK_CLIENT_ID = process.env.KEYCLOAK_CLIENT_ID || 'news-worker';
const KEYCLOAK_CLIENT_SECRET = process.env.KEYCLOAK_CLIENT_SECRET || '';
export const WHATSAPP_URL = process.env.WHATSAPP_URL || 'http://whatsapp';

export async function getServiceToken(): Promise<string> {
    const tokenUrl = `${KEYCLOAK_URL}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/token`;
    const response = await fetch(tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            grant_type: 'client_credentials',
            client_id: KEYCLOAK_CLIENT_ID,
            client_secret: KEYCLOAK_CLIENT_SECRET,
        }),
    });

    if (!response.ok) {
        throw new Error(`Failed to get service token: ${response.status} ${await response.text()}`);
    }

    const data = await response.json();
    return data.access_token;
}

export interface SessionInfo {
    userId: string;
    phone: string;
}

export async function lookupSessions(userIds: string[]): Promise<SessionInfo[]> {
    const token = await getServiceToken();
    const response = await fetch(`${WHATSAPP_URL}/api/sessions/lookup`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ userIds }),
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Sessions lookup failed: ${response.status} ${errorText}`);
    }

    const data = await response.json();
    return data.sessions;
}
