import { query } from '$lib/server/db';

// ... (existing imports and code)

export const load: PageServerLoad = async ({ url }) => {
    // ... (existing weather logic)

    // Fetch speedtest results
    let speedtestResults = [];
    try {
        const res = await query(`
            SELECT 
                timestamp,
                server_name,
                server_country,
                latency_ms,
                download_bandwidth,
                upload_bandwidth
            FROM speedtest_results
            ORDER BY timestamp DESC
            LIMIT 100
        `);
        speedtestResults = res.rows;
    } catch (e) {
        console.error("Error fetching speedtest results:", e);
    }

    // ... (existing return logic, add speedtestResults)
    return {
        // ... (existing fields)
        speedtestResults,
        // ...
    };
};

