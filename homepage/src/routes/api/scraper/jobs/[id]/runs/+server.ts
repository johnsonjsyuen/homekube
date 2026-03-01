import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

const BACKEND_URL = 'http://workflows-worker.temporal.svc.cluster.local';

export const GET: RequestHandler = async ({ request, params, url }) => {
    const authHeader = request.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return json({ error: 'Unauthorized: Missing or invalid token' }, { status: 401 });
    }

    try {
        const limit = url.searchParams.get('limit') || '20';
        const response = await fetch(`${BACKEND_URL}/api/jobs/${params.id}/runs?limit=${limit}`, {
            headers: { 'Authorization': authHeader }
        });

        const text = await response.text();
        if (!text) {
            return json({ error: 'Unauthorized' }, { status: response.status });
        }
        return json(JSON.parse(text), { status: response.status });
    } catch (e) {
        console.error('Error proxying to workflows-worker runs:', e);
        return json({ error: 'Internal Server Error' }, { status: 500 });
    }
};
