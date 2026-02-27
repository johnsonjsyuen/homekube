import type { Headline } from './fetchRss.js';

export interface Article {
    title: string;
    link: string;
    text: string;
}

export async function scrapeArticles(headlines: Headline[]): Promise<Article[]> {
    const articles: Article[] = [];

    for (const headline of headlines) {
        try {
            const response = await fetch(headline.link);
            if (!response.ok) {
                console.warn(`[Scrape] Failed to fetch ${headline.link}: ${response.status}`);
                continue;
            }
            const html = await response.text();

            // Extract text content from article body
            // Remove script/style tags, then strip HTML tags
            let text = html
                .replace(/<script[\s\S]*?<\/script>/gi, '')
                .replace(/<style[\s\S]*?<\/style>/gi, '')
                .replace(/<nav[\s\S]*?<\/nav>/gi, '')
                .replace(/<header[\s\S]*?<\/header>/gi, '')
                .replace(/<footer[\s\S]*?<\/footer>/gi, '');

            // Try to extract main article content between common article markers
            const articleMatch = text.match(/<article[\s\S]*?<\/article>/i);
            if (articleMatch) {
                text = articleMatch[0];
            }

            // Strip remaining HTML tags and normalize whitespace
            text = text
                .replace(/<[^>]+>/g, ' ')
                .replace(/&nbsp;/g, ' ')
                .replace(/&amp;/g, '&')
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>')
                .replace(/&quot;/g, '"')
                .replace(/&#39;/g, "'")
                .replace(/\s+/g, ' ')
                .trim();

            // Limit text length to avoid huge payloads
            if (text.length > 3000) {
                text = text.slice(0, 3000) + '...';
            }

            if (text.length > 100) {
                articles.push({
                    title: headline.title,
                    link: headline.link,
                    text,
                });
            }
        } catch (err) {
            console.error(`[Scrape] Error scraping ${headline.link}:`, err);
        }
    }

    return articles;
}
