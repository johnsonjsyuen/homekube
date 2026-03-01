package com.homekube.webscraper.activities

import com.homekube.webscraper.ScrapedContent
import jakarta.enterprise.context.ApplicationScoped
import org.jboss.logging.Logger
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.time.Duration

@ApplicationScoped
class ScrapeUrlsActivity {

    private val log = Logger.getLogger(ScrapeUrlsActivity::class.java)

    companion object {
        private const val MAX_TEXT_LENGTH = 5000
        private const val TIMEOUT_SECONDS = 30L
        private const val USER_AGENT = "Mozilla/5.0 (compatible; HomekubeScraper/1.0)"
    }

    private val httpClient: HttpClient = HttpClient.newBuilder()
        .connectTimeout(Duration.ofSeconds(TIMEOUT_SECONDS))
        .followRedirects(HttpClient.Redirect.NORMAL)
        .build()

    fun execute(urls: List<String>): List<ScrapedContent> {
        val results = mutableListOf<ScrapedContent>()

        for (url in urls) {
            try {
                val request = HttpRequest.newBuilder()
                    .uri(URI.create(url))
                    .timeout(Duration.ofSeconds(TIMEOUT_SECONDS))
                    .header("User-Agent", USER_AGENT)
                    .GET()
                    .build()

                val response = httpClient.send(request, HttpResponse.BodyHandlers.ofString())

                if (response.statusCode() !in 200..299) {
                    log.warnf("[Scrape] HTTP %d for %s, skipping", response.statusCode(), url)
                    continue
                }

                val text = extractText(response.body())

                if (text.isBlank()) {
                    log.warnf("[Scrape] Empty content for %s, skipping", url)
                    continue
                }

                results.add(ScrapedContent(url = url, text = text.take(MAX_TEXT_LENGTH)))
            } catch (e: java.net.http.HttpTimeoutException) {
                log.warnf("[Scrape] Timeout for %s, skipping", url)
            } catch (e: Exception) {
                log.warnf("[Scrape] Error fetching %s: %s, skipping", url, e.message)
            }
        }

        return results
    }

    /** Strip HTML to plain text, matching the TypeScript extractText logic exactly. */
    internal fun extractText(html: String): String {
        var text = html
        // Remove script and style elements
        text = text.replace(Regex("<script[\\s\\S]*?</script>", RegexOption.IGNORE_CASE), "")
        text = text.replace(Regex("<style[\\s\\S]*?</style>", RegexOption.IGNORE_CASE), "")
        // Remove HTML tags
        text = text.replace(Regex("<[^>]+>"), " ")
        // Decode common HTML entities
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
