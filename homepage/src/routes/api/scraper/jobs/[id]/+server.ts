import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

const BACKEND_URL = 'http://web-scraper.temporal.svc.cluster.local';

async function proxyResponse(response: Response) {
    const text = await response.text();
    if (!text) {
        return json({ error: 'Unauthorized' }, { status: response.status });
    }
    return json(JSON.parse(text), { status: response.status });
}

export const GET: RequestHandler = async ({ request, params }) => {
    const authHeader = request.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return json({ error: 'Unauthorized: Missing or invalid token' }, { status: 401 });
    }

    try {
        const response = await fetch(`${BACKEND_URL}/api/jobs/${params.id}`, {
            headers: { 'Authorization': authHeader }
        });

        return proxyResponse(response);
    } catch (e) {
        console.error('Error proxying to web-scraper get job:', e);
        return json({ error: 'Internal Server Error' }, { status: 500 });
    }
};

export const PUT: RequestHandler = async ({ request, params }) => {
    const authHeader = request.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return json({ error: 'Unauthorized: Missing or invalid token' }, { status: 401 });
    }

    try {
        const body = await request.json();
        const response = await fetch(`${BACKEND_URL}/api/jobs/${params.id}`, {
            method: 'PUT',
            headers: {
                'Authorization': authHeader,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
        });

        return proxyResponse(response);
    } catch (e) {
        console.error('Error proxying to web-scraper update job:', e);
        return json({ error: 'Internal Server Error' }, { status: 500 });
    }
};

export const DELETE: RequestHandler = async ({ request, params }) => {
    const authHeader = request.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return json({ error: 'Unauthorized: Missing or invalid token' }, { status: 401 });
    }

    try {
        const response = await fetch(`${BACKEND_URL}/api/jobs/${params.id}`, {
            method: 'DELETE',
            headers: { 'Authorization': authHeader }
        });

        return proxyResponse(response);
    } catch (e) {
        console.error('Error proxying to web-scraper delete job:', e);
        return json({ error: 'Internal Server Error' }, { status: 500 });
    }
};
