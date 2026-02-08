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

    const { getAllMockJobs } = await import('$lib/mocks/data/tts');

    try {
        // Simulate network delay
        await new Promise(resolve => setTimeout(resolve, 150));

        // Get all mock jobs
        const jobs = getAllMockJobs();

        // Transform to match expected API format
        const jobsData = jobs.map(job => ({
            id: job.id,
            filename: job.filename,
            voice: job.voice,
            speed: job.speed,
            status: job.status,
            createdAt: job.createdAt.toISOString(),
            completedAt: job.completedAt?.toISOString(),
            error: job.error
        }));

        console.log('[TTS Jobs] Mock mode: Returning', jobsData.length, 'jobs');

        return json(jobsData);
    } catch (e) {
        console.error('[TTS Jobs] Mock error:', e);
        return json({ error: 'Internal Server Error' }, { status: 500 });
    }
};

// Production implementation
const productionHandler: RequestHandler = async ({ request }) => {
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

// Export the appropriate handler
export const GET = isMockMode ? mockHandler : productionHandler;
