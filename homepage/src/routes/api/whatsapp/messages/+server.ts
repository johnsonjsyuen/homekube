import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ request, url }) => {
    const authHeader = request.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return json({ error: 'Unauthorized: Missing or invalid token' }, { status: 401 });
    }

    try {
        const queryString = url.searchParams.toString();
        const backendUrl = `http://whatsapp/api/messages${queryString ? `?${queryString}` : ''}`;
        const response = await fetch(backendUrl, {
            headers: { 'Authorization': authHeader }
        });

        const data = await response.json();
        return json(data, { status: response.status });
    } catch (e) {
        console.error('Error proxying to WhatsApp messages:', e);
        return json({ error: 'Internal Server Error' }, { status: 500 });
    }
};
