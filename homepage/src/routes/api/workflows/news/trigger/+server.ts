import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
    const authHeader = request.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return json({ error: 'Unauthorized: Missing or invalid token' }, { status: 401 });
    }

    try {
        const response = await fetch('http://news-worker.temporal.svc.cluster.local/api/news/trigger', {
            method: 'POST',
            headers: { 'Authorization': authHeader }
        });

        const data = await response.json();
        return json(data, { status: response.status });
    } catch (e) {
        console.error('Error proxying to news-worker trigger:', e);
        return json({ error: 'Internal Server Error' }, { status: 500 });
    }
};
