import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

const BACKEND_URL = 'http://web-scraper.temporal.svc.cluster.local';

export const GET: RequestHandler = async ({ request }) => {
    const authHeader = request.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return json({ error: 'Unauthorized: Missing or invalid token' }, { status: 401 });
    }

    try {
        const response = await fetch(`${BACKEND_URL}/api/jobs`, {
            headers: { 'Authorization': authHeader }
        });

        const data = await response.json();
        return json(data, { status: response.status });
    } catch (e) {
        console.error('Error proxying to web-scraper list jobs:', e);
        return json({ error: 'Internal Server Error' }, { status: 500 });
    }
};

export const POST: RequestHandler = async ({ request }) => {
    const authHeader = request.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return json({ error: 'Unauthorized: Missing or invalid token' }, { status: 401 });
    }

    try {
        const body = await request.json();
        const response = await fetch(`${BACKEND_URL}/api/jobs`, {
            method: 'POST',
            headers: {
                'Authorization': authHeader,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
        });

        const data = await response.json();
        return json(data, { status: response.status });
    } catch (e) {
        console.error('Error proxying to web-scraper create job:', e);
        return json({ error: 'Internal Server Error' }, { status: 500 });
    }
};
