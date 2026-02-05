import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, request }) => {
    const { id } = params;

    // Check for Authorization header
    const authHeader = request.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return new Response(JSON.stringify({ error: 'Unauthorized: Missing or invalid token' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    try {
        const response = await fetch(`http://text-to-speech/status/${id}`, {
            headers: {
                'Authorization': authHeader
            }
        });

        // Construct new response with body stream and headers from upstream
        const newHeaders = new Headers(response.headers);
        // Ensure proper CORS or allow-origin if needed, though usually same-origin SvelteKit handles it.

        return new Response(response.body, {
            status: response.status,
            statusText: response.statusText,
            headers: newHeaders
        });
    } catch (e) {
        console.error('Error proxying TTS status:', e);
        return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
};
