import { parseHTML } from 'linkedom';
import type { EconomistHeadline } from './fetchEconomistRss.js';

export interface EconomistArticle {
    title: string;
    link: string;
    text: string;
}

const USER_AGENT = 'Lamarr';

const REMOVE_SELECTORS = [
    'script', 'style', 'nav', 'footer', 'header', 'aside',
    'figure', 'img', 'svg', 'iframe', 'noscript',
    "[class*='ad']", "[class*='Ad']",
];

export async function scrapeEconomistArticles(headlines: EconomistHeadline[]): Promise<EconomistArticle[]> {
    const articles: EconomistArticle[] = [];

    for (const headline of headlines) {
        let text = '';

        try {
            const response = await fetch(headline.link, {
                headers: { 'User-Agent': USER_AGENT },
            });

            if (response.ok) {
                const html = await response.text();
                const { document } = parseHTML(html);

                for (const sel of REMOVE_SELECTORS) {
                    document.querySelectorAll(sel).forEach((el: any) => el.remove());
                }

                const article = document.querySelector('article') ?? document.body;
                text = article.textContent
                    .replace(/[ \t]+/g, ' ')
                    .split('\n')
                    .map((l: string) => l.trim())
                    .filter(Boolean)
                    .join('\n');

                if (text.length > 3000) {
                    text = text.slice(0, 3000) + '...';
                }
            }
        } catch (err) {
            console.warn(`[Economist Scrape] Failed to scrape ${headline.link}:`, err);
        }

        // Fallback: use RSS description if scraping failed or returned too little text
        if (text.length < 100 && headline.description) {
            text = headline.description;
            console.log(`[Economist Scrape] Using RSS description for: ${headline.title}`);
        }

        if (text.length > 0) {
            articles.push({
                title: headline.title,
                link: headline.link,
                text,
            });
        }
    }

    return articles;
}
