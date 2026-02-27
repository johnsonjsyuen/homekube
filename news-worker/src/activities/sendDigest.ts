import { getServiceToken, WHATSAPP_URL } from './whatsappClient.js';

export interface SendDigestInput {
    digest: string;
    subscribers: Array<{ userId: string; phone: string }>;
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
