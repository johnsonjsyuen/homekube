export interface SendDigestInput {
    digest: string;
    subscribers: Array<{ userId: string; phone: string }>;
}

const KEYCLOAK_URL = process.env.KEYCLOAK_URL || 'http://keycloak.keycloak.svc.cluster.local';
const KEYCLOAK_REALM = process.env.KEYCLOAK_REALM || 'homekube';
const KEYCLOAK_CLIENT_ID = process.env.KEYCLOAK_CLIENT_ID || 'news-worker';
const KEYCLOAK_CLIENT_SECRET = process.env.KEYCLOAK_CLIENT_SECRET || '';
const WHATSAPP_URL = process.env.WHATSAPP_URL || 'http://whatsapp';

async function getServiceToken(): Promise<string> {
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

export async function sendDigest(input: SendDigestInput): Promise<void> {
    const token = await getServiceToken();

    for (const subscriber of input.subscribers) {
        try {
            const response = await fetch(`${WHATSAPP_URL}/api/send`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    userId: subscriber.userId,
                    recipientPhone: subscriber.phone,
                    message: input.digest,
                }),
            });

            if (!response.ok) {
                const errorText = await response.text();
                console.error(`[Send] Failed to send to ${subscriber.phone}: ${response.status} ${errorText}`);
            } else {
                console.log(`[Send] Digest sent to ${subscriber.phone}`);
            }
        } catch (err) {
            console.error(`[Send] Error sending to ${subscriber.phone}:`, err);
        }
    }
}
