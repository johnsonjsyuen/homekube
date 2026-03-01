import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

const BACKEND_URL = 'http://workflows-worker.temporal.svc.cluster.local';

export const GET: RequestHandler = async ({ request }) => {
    const authHeader = request.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return json({ error: 'Unauthorized: Missing or invalid token' }, { status: 401 });
    }

    try {
        const response = await fetch(`${BACKEND_URL}/api/jobs`, {
            headers: { 'Authorization': authHeader }
        });

        const text = await response.text();
        if (!text) {
            return json({ error: 'Unauthorized' }, { status: response.status });
        }
        const data = JSON.parse(text);
        return json(data, { status: response.status });
    } catch (e) {
        console.error('Error proxying to workflows-worker list jobs:', e);
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

        const text = await response.text();
        if (!text) {
            return json({ error: 'Unauthorized' }, { status: response.status });
        }
        const data = JSON.parse(text);
        return json(data, { status: response.status });
    } catch (e) {
        console.error('Error proxying to workflows-worker create job:', e);
        return json({ error: 'Internal Server Error' }, { status: 500 });
    }
};
