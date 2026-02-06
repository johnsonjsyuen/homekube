import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
    try {
        // Check for Authorization header
        const authHeader = request.headers.get('Authorization');
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return json({ error: 'Unauthorized: Missing or invalid token' }, { status: 401 });
        }

        const formData = await request.formData();

        // Forward request to text-to-speech service with Authorization header
        // The service name is 'text-to-speech', port 80 (mapped to 3000)
        const response = await fetch('http://text-to-speech/generate', {
            method: 'POST',
            body: formData,
            headers: {
                'Authorization': authHeader
            }
            // DO NOT set Content-Type header manually when sending FormData,
            // fetch will set it correctly with boundary
        });

        if (!response.ok) {
            const errorText = await response.text();
            return json({ error: `Start generation failed: ${response.status} ${errorText}` }, { status: response.status });
        }

        const data = await response.json();
        return json(data);
    } catch (e) {
        console.error('Error proxying to TTS service:', e);
        return json({ error: 'Internal Server Error' }, { status: 500 });
    }
};
