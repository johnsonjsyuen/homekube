export interface ScrapedContent {
    url: string;
    text: string;
}

export async function scrapeUrls(urls: string[]): Promise<ScrapedContent[]> {
    const results: ScrapedContent[] = [];

    for (const url of urls) {
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 30000);

            const response = await fetch(url, {
                signal: controller.signal,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (compatible; HomekubeScraper/1.0)',
                },
            });

            clearTimeout(timeout);

            if (!response.ok) {
                console.warn(`[Scrape] HTTP ${response.status} for ${url}, skipping`);
                continue;
            }

            const html = await response.text();
            const text = extractText(html);

            if (text.trim().length > 0) {
                results.push({ url, text: text.slice(0, 5000) });
            } else {
                console.warn(`[Scrape] Empty content for ${url}, skipping`);
            }
        } catch (err: any) {
            if (err.name === 'AbortError') {
                console.warn(`[Scrape] Timeout for ${url}, skipping`);
            } else {
                console.warn(`[Scrape] Error fetching ${url}: ${err.message}, skipping`);
            }
        }
    }

    return results;
}

function extractText(html: string): string {
    // Remove script and style elements
    let text = html.replace(/<script[\s\S]*?<\/script>/gi, '');
    text = text.replace(/<style[\s\S]*?<\/style>/gi, '');
    // Remove HTML tags
    text = text.replace(/<[^>]+>/g, ' ');
    // Decode common HTML entities
    text = text.replace(/&amp;/g, '&');
    text = text.replace(/&lt;/g, '<');
    text = text.replace(/&gt;/g, '>');
    text = text.replace(/&quot;/g, '"');
    text = text.replace(/&#39;/g, "'");
    text = text.replace(/&nbsp;/g, ' ');
    // Collapse whitespace
    text = text.replace(/\s+/g, ' ').trim();
    return text;
}
