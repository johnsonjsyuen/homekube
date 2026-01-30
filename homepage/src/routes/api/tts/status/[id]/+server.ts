import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params }) => {
    const { id } = params;

    try {
        const response = await fetch(`http://text-to-speech/status/${id}`);

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
