import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

const isMockMode = import.meta.env.VITE_DEV_MODE === 'mock';

// Mock implementation
const mockHandler: RequestHandler = async ({ request }) => {
    // Check for Authorization header
    const authHeader = request.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return json({ error: 'Unauthorized: Missing or invalid token' }, { status: 401 });
    }

    const { createMockJob } = await import('$lib/mocks/data/tts');

    try {
        const formData = await request.formData();

        // Extract parameters from form data
        const file = formData.get('file') as File | null;
        const voice = formData.get('voice') as string || 'alloy';
        const speed = parseFloat(formData.get('speed') as string || '1.0');

        const filename = file?.name || 'unknown.txt';

        // Simulate network delay
        await new Promise(resolve => setTimeout(resolve, 300));

        // Create mock job
        const jobId = createMockJob(filename, voice, speed);

        console.log('[TTS Generate] Mock mode: Created job', jobId);

        return json({ id: jobId });
    } catch (e) {
        console.error('[TTS Generate] Mock error:', e);
        return json({ error: 'Internal Server Error' }, { status: 500 });
    }
};

// Production implementation
const productionHandler: RequestHandler = async ({ request }) => {
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

export const POST = isMockMode ? mockHandler : productionHandler;
