package com.homekube.worker.activities

import com.homekube.worker.Headline
import jakarta.enterprise.context.ApplicationScoped
import org.jboss.logging.Logger
import java.io.StringReader
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.time.Duration
import javax.xml.parsers.DocumentBuilderFactory

@ApplicationScoped
class FetchRssActivity {

    private val log = Logger.getLogger(FetchRssActivity::class.java)

    companion object {
        private val NEWS_FEEDS = listOf(
            "https://www.abc.net.au/news/feed/51120/rss.xml",
            "https://www.abc.net.au/news/feed/45910/rss.xml",
        )
        private val ECONOMIST_FEEDS = listOf(
            "https://www.economist.com/leaders/rss.xml",
            "https://www.economist.com/finance-and-economics/rss.xml",
            "https://www.economist.com/business/rss.xml",
        )
        private const val NEWS_LIMIT = 20
        private const val ECONOMIST_LIMIT = 15
    }

    private val httpClient: HttpClient = HttpClient.newBuilder()
        .version(HttpClient.Version.HTTP_1_1)
        .connectTimeout(Duration.ofSeconds(30))
        .followRedirects(HttpClient.Redirect.NORMAL)
        .build()

    fun execute(digestType: String): List<Headline> {
        val feeds = if (digestType == "economist") ECONOMIST_FEEDS else NEWS_FEEDS
        val limit = if (digestType == "economist") ECONOMIST_LIMIT else NEWS_LIMIT
        val userAgent = if (digestType == "economist") "Lamarr" else "Mozilla/5.0 (compatible; HomekubeScraper/1.0)"

        val allItems = mutableListOf<Headline>()
        val seenLinks = mutableSetOf<String>()

        for (feedUrl in feeds) {
            try {
                val request = HttpRequest.newBuilder()
                    .uri(URI.create(feedUrl))
                    .timeout(Duration.ofSeconds(30))
                    .header("User-Agent", userAgent)
                    .GET()
                    .build()

                val response = httpClient.send(request, HttpResponse.BodyHandlers.ofString())

                if (response.statusCode() !in 200..299) {
                    log.warnf("[RSS] Failed to fetch %s: HTTP %d", feedUrl, response.statusCode())
                    continue
                }

                val headlines = parseRssFeed(response.body())
                for (headline in headlines) {
                    if (headline.link.isNotBlank() && seenLinks.add(headline.link)) {
                        allItems.add(headline)
                    }
                }
            } catch (e: Exception) {
                log.errorf("[RSS] Error fetching %s: %s", feedUrl, e.message)
            }
        }

        // Sort by pubDate descending (best effort parsing), take top N
        allItems.sortByDescending { parseDate(it.pubDate) }
        val result = allItems.take(limit)
        log.infof("[RSS] Fetched %d %s headlines from %d feeds", result.size, digestType, feeds.size)
        return result
    }

    private fun parseRssFeed(xml: String): List<Headline> {
        val headlines = mutableListOf<Headline>()
        try {
            val factory = DocumentBuilderFactory.newInstance()
            // Disable external entities for security
            factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true)
            factory.setFeature("http://xml.org/sax/features/external-general-entities", false)
            factory.setFeature("http://xml.org/sax/features/external-parameter-entities", false)

            val builder = factory.newDocumentBuilder()
            val doc = builder.parse(org.xml.sax.InputSource(StringReader(xml)))

            val items = doc.getElementsByTagName("item")
            for (i in 0 until items.length) {
                val item = items.item(i)
                var title = ""
                var link = ""
                var pubDate = ""
                var description = ""

                val children = item.childNodes
                for (j in 0 until children.length) {
                    val child = children.item(j)
                    when (child.nodeName) {
                        "title" -> title = child.textContent?.trim() ?: ""
                        "link" -> link = child.textContent?.trim() ?: ""
                        "pubDate" -> pubDate = child.textContent?.trim() ?: ""
                        "description" -> description = child.textContent?.trim() ?: ""
                    }
                }

                if (link.isNotBlank()) {
                    headlines.add(Headline(title = title, link = link, pubDate = pubDate, description = description))
                }
            }
        } catch (e: Exception) {
            log.warnf("[RSS] Failed to parse RSS XML: %s", e.message)
        }
        return headlines
    }

    private fun parseDate(dateStr: String): Long {
        return try {
            java.time.ZonedDateTime.parse(dateStr, java.time.format.DateTimeFormatter.RFC_1123_DATE_TIME)
                .toInstant().toEpochMilli()
        } catch (e: Exception) {
            0L
        }
    }
}
