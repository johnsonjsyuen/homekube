import type { RequestHandler } from './$types';

const isMockMode = import.meta.env.VITE_DEV_MODE === 'mock';

// Mock implementation
const mockHandler: RequestHandler = async ({ params, request }) => {
    const { id } = params;

    // Check for Authorization header
    const authHeader = request.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return new Response(JSON.stringify({ error: 'Unauthorized: Missing or invalid token' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    const { getMockJob } = await import('$lib/mocks/data/tts');

    try {
        const job = getMockJob(id);

        if (!job) {
            return new Response(JSON.stringify({ error: 'Job not found' }), {
                status: 404,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        console.log('[TTS Status] Mock mode: Job', id, 'status:', job.status);

        // If job is completed, return the audio blob
        if (job.status === 'completed' && job.audioBlob) {
            const arrayBuffer = await job.audioBlob.arrayBuffer();
            return new Response(arrayBuffer, {
                status: 200,
                headers: {
                    'Content-Type': 'audio/mpeg',
                    'Content-Length': String(arrayBuffer.byteLength)
                }
            });
        }

        // Otherwise return JSON status
        return new Response(JSON.stringify({
            id: job.id,
            status: job.status,
            filename: job.filename,
            voice: job.voice,
            speed: job.speed,
            createdAt: job.createdAt.toISOString(),
            completedAt: job.completedAt?.toISOString(),
            error: job.error
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (e) {
        console.error('[TTS Status] Mock error:', e);
        return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
};

// Production implementation
const productionHandler: RequestHandler = async ({ params, request }) => {
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

export const GET = isMockMode ? mockHandler : productionHandler;
