import { XMLParser } from 'fast-xml-parser';

export interface EconomistHeadline {
    title: string;
    link: string;
    pubDate: string;
    description: string;
}

const ECONOMIST_RSS_FEEDS = [
    'https://www.economist.com/leaders/rss.xml',
    'https://www.economist.com/finance-and-economics/rss.xml',
    'https://www.economist.com/business/rss.xml',
];

export async function fetchEconomistHeadlines(): Promise<EconomistHeadline[]> {
    const parser = new XMLParser({ ignoreAttributes: false });
    const allItems: EconomistHeadline[] = [];
    const seenLinks = new Set<string>();

    for (const feedUrl of ECONOMIST_RSS_FEEDS) {
        try {
            const response = await fetch(feedUrl, {
                headers: { 'User-Agent': 'Lamarr' },
            });
            if (!response.ok) {
                console.warn(`[Economist RSS] Failed to fetch ${feedUrl}: ${response.status}`);
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
                        title: (item.title || '').replace(/^\s+|\s+$/g, ''),
                        link,
                        pubDate: item.pubDate || '',
                        description: (item.description || '').replace(/^\s+|\s+$/g, ''),
                    });
                }
            }
        } catch (err) {
            console.error(`[Economist RSS] Error fetching ${feedUrl}:`, err);
        }
    }

    // Sort by date descending, take top 15
    allItems.sort((a, b) => new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime());
    return allItems.slice(0, 15);
}
