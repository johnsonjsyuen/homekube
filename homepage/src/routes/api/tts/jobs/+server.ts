import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ request }) => {
    // Check for Authorization header
    const authHeader = request.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return json({ error: 'Unauthorized: Missing or invalid token' }, { status: 401 });
    }

    try {
        // Forward request to text-to-speech service
        const response = await fetch('http://text-to-speech/jobs', {
            headers: {
                'Authorization': authHeader
            }
        });

        if (!response.ok) {
            const errorText = await response.text();
            return json({ error: `Failed to fetch jobs: ${response.status} ${errorText}` }, { status: response.status });
        }

        const data = await response.json();
        return json(data);
    } catch (e) {
        console.error('Error proxying to TTS jobs endpoint:', e);
        return json({ error: 'Internal Server Error' }, { status: 500 });
    }
};
