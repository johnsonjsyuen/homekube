import { XMLParser } from 'fast-xml-parser';
import { workflowArticlesFetchedTotal } from '../metrics.js';

export interface Headline {
    title: string;
    link: string;
    pubDate: string;
    description: string;
}

const RSS_FEEDS = [
    'https://www.abc.net.au/news/feed/51120/rss.xml', // Top Stories
    'https://www.abc.net.au/news/feed/45910/rss.xml',  // Just In
];

export async function fetchRssHeadlines(): Promise<Headline[]> {
    const parser = new XMLParser({ ignoreAttributes: false });
    const allItems: Headline[] = [];
    const seenLinks = new Set<string>();

    for (const feedUrl of RSS_FEEDS) {
        try {
            const response = await fetch(feedUrl);
            if (!response.ok) {
                console.warn(`[RSS] Failed to fetch ${feedUrl}: ${response.status}`);
                continue;
            }
            const xml = await response.text();
            const parsed = parser.parse(xml);
            const items = parsed?.rss?.channel?.item || [];
            const itemList = Array.isArray(items) ? items : [items];

            for (const item of itemList) {
                const link = item.link || '';
                if (link && !seenLinks.has(link)) {
                    seenLinks.add(link);
                    allItems.push({
                        title: item.title || '',
                        link,
                        pubDate: item.pubDate || '',
                        description: item.description || '',
                    });
                }
            }
        } catch (err) {
            console.error(`[RSS] Error fetching ${feedUrl}:`, err);
        }
    }

    // Sort by date descending, take top 20
    allItems.sort((a, b) => new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime());
    const result = allItems.slice(0, 20);
    workflowArticlesFetchedTotal.inc({ workflow: 'news' }, result.length);
    return result;
}
