import { parseHTML } from "linkedom";

const DEFAULT_USER_AGENT = "Lamarr";

const url = process.argv[2];
if (!url) {
  console.error("Usage: npx tsx get-article.ts <url> [user-agent]");
  process.exit(1);
}

const userAgent = process.argv[3] ?? DEFAULT_USER_AGENT;

const response = await fetch(url, {
  headers: { "User-Agent": userAgent },
});

if (!response.ok) {
  console.error(`HTTP ${response.status} ${response.statusText}`);
  process.exit(1);
}

const html = await response.text();
const { document } = parseHTML(html);

for (const sel of ["script", "style", "nav", "footer", "header", "aside", "figure", "img", "svg", "iframe", "noscript", "[class*='ad']", "[class*='Ad']"]) {
  document.querySelectorAll(sel).forEach((el: any) => el.remove());
}

const article = document.querySelector("article") ?? document.body;

const text = article.textContent
  .replace(/[ \t]+/g, " ")
  .split("\n")
  .map((l: string) => l.trim())
  .filter(Boolean)
  .join("\n");

console.log(text);
