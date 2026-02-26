import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
    const authHeader = request.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return json({ error: 'Unauthorized: Missing or invalid token' }, { status: 401 });
    }

    try {
        const body = await request.json();
        const response = await fetch('http://whatsapp/api/send', {
            method: 'POST',
            headers: {
                'Authorization': authHeader,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(body)
        });

        const data = await response.json();
        return json(data, { status: response.status });
    } catch (e) {
        console.error('Error proxying to WhatsApp send:', e);
        return json({ error: 'Internal Server Error' }, { status: 500 });
    }
};
