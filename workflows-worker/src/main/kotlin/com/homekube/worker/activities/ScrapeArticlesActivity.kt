package com.homekube.worker.activities

import com.homekube.worker.Article
import com.homekube.worker.Headline
import jakarta.enterprise.context.ApplicationScoped
import org.jboss.logging.Logger
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.time.Duration

@ApplicationScoped
class ScrapeArticlesActivity {

    private val log = Logger.getLogger(ScrapeArticlesActivity::class.java)

    companion object {
        private const val MAX_TEXT_LENGTH = 3000
        private const val MIN_TEXT_LENGTH = 100
        private const val TIMEOUT_SECONDS = 30L
    }

    private val httpClient: HttpClient = HttpClient.newBuilder()
        .version(HttpClient.Version.HTTP_1_1)
        .connectTimeout(Duration.ofSeconds(TIMEOUT_SECONDS))
        .followRedirects(HttpClient.Redirect.NORMAL)
        .build()

    fun execute(headlines: List<Headline>, digestType: String): List<Article> {
        val articles = mutableListOf<Article>()
        val userAgent = if (digestType == "economist") "Lamarr" else "Mozilla/5.0 (compatible; HomekubeScraper/1.0)"

        for (headline in headlines) {
            var text = ""

            try {
                val request = HttpRequest.newBuilder()
                    .uri(URI.create(headline.link))
                    .timeout(Duration.ofSeconds(TIMEOUT_SECONDS))
                    .header("User-Agent", userAgent)
                    .GET()
                    .build()

                val response = httpClient.send(request, HttpResponse.BodyHandlers.ofString())

                if (response.statusCode() in 200..299) {
                    text = extractArticleText(response.body())
                    if (text.length > MAX_TEXT_LENGTH) {
                        text = text.take(MAX_TEXT_LENGTH) + "..."
                    }
                } else {
                    log.warnf("[Scrape] HTTP %d for %s", response.statusCode(), headline.link)
                }
            } catch (e: Exception) {
                log.warnf("[Scrape] Error scraping %s: %s", headline.link, e.message)
            }

            // Fallback: use RSS description for Economist if scrape yielded too little
            if (text.length < MIN_TEXT_LENGTH && headline.description.isNotBlank()) {
                text = headline.description
                log.infof("[Scrape] Using RSS description for: %s", headline.title)
            }

            if (text.isNotBlank()) {
                articles.add(Article(title = headline.title, link = headline.link, text = text))
            }
        }

        return articles
    }

    /** Extract text from HTML, targeting <article> tags when available. */
    internal fun extractArticleText(html: String): String {
        // Try to extract <article> content first
        val articleMatch = Regex("<article[\\s\\S]*?</article>", RegexOption.IGNORE_CASE).find(html)
        val source = articleMatch?.value ?: html

        var text = source
        // Remove script/style/nav/header/footer elements
        text = text.replace(Regex("<script[\\s\\S]*?</script>", RegexOption.IGNORE_CASE), "")
        text = text.replace(Regex("<style[\\s\\S]*?</style>", RegexOption.IGNORE_CASE), "")
        text = text.replace(Regex("<nav[\\s\\S]*?</nav>", RegexOption.IGNORE_CASE), "")
        text = text.replace(Regex("<header[\\s\\S]*?</header>", RegexOption.IGNORE_CASE), "")
        text = text.replace(Regex("<footer[\\s\\S]*?</footer>", RegexOption.IGNORE_CASE), "")
        text = text.replace(Regex("<aside[\\s\\S]*?</aside>", RegexOption.IGNORE_CASE), "")
        text = text.replace(Regex("<figure[\\s\\S]*?</figure>", RegexOption.IGNORE_CASE), "")
        // Strip remaining HTML tags
        text = text.replace(Regex("<[^>]+>"), " ")
        // Decode HTML entities
        text = text.replace("&amp;", "&")
        text = text.replace("&lt;", "<")
        text = text.replace("&gt;", ">")
        text = text.replace("&quot;", "\"")
        text = text.replace("&#39;", "'")
        text = text.replace("&nbsp;", " ")
        // Collapse whitespace
        text = text.replace(Regex("\\s+"), " ").trim()
        return text
    }
}
