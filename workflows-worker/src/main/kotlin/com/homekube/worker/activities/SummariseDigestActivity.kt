package com.homekube.worker.activities

import com.fasterxml.jackson.databind.ObjectMapper
import com.homekube.worker.SummariseDigestInput
import jakarta.enterprise.context.ApplicationScoped
import jakarta.inject.Inject
import org.eclipse.microprofile.config.inject.ConfigProperty
import org.jboss.logging.Logger
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.time.Duration

@ApplicationScoped
class SummariseDigestActivity {

    private val log = Logger.getLogger(SummariseDigestActivity::class.java)

    @ConfigProperty(name = "app.claude-api.url")
    lateinit var claudeApiUrl: String

    @Inject
    lateinit var objectMapper: ObjectMapper

    private val httpClient: HttpClient = HttpClient.newBuilder()
        .version(HttpClient.Version.HTTP_1_1)
        .connectTimeout(Duration.ofSeconds(30))
        .build()

    fun execute(input: SummariseDigestInput): String {
        val articleText = input.articles.mapIndexed { i, a ->
            "Article ${i + 1}: ${a.title}\nURL: ${a.link}\n${a.text}"
        }.joinToString("\n\n---\n\n")

        val prompt = if (input.digestType == "economist") {
            buildEconomistPrompt(articleText)
        } else {
            buildNewsPrompt(articleText)
        }

        val requestBody = objectMapper.writeValueAsString(
            mapOf(
                "prompt" to prompt,
                "output_format" to "text",
                "timeout_seconds" to 120,
            )
        )

        val request = HttpRequest.newBuilder()
            .uri(URI.create("$claudeApiUrl/api/analyze"))
            .timeout(Duration.ofMinutes(3))
            .header("Content-Type", "application/json")
            .POST(HttpRequest.BodyPublishers.ofString(requestBody))
            .build()

        val response = httpClient.send(request, HttpResponse.BodyHandlers.ofString())

        if (response.statusCode() !in 200..299) {
            throw RuntimeException("Claude API returned HTTP ${response.statusCode()}: ${response.body()}")
        }

        val responseBody = response.body()
        if (responseBody.isNullOrBlank()) {
            throw RuntimeException("Claude returned empty response")
        }

        // Extract the "response" field from the API response
        return try {
            val responseJson = objectMapper.readTree(responseBody)
            val digest = responseJson.get("response")?.asText() ?: responseBody
            if (digest.isBlank()) throw RuntimeException("Claude returned empty digest")
            digest.trim()
        } catch (e: Exception) {
            log.warnf("[Claude] Failed to parse response, using raw body: %s", e.message)
            responseBody.trim()
        }
    }

    private fun buildNewsPrompt(articleText: String): String = """
        |You are a news digest assistant. Summarise the following Australian news articles into a WhatsApp-friendly daily digest.
        |
        |Format rules:
        |- Start with a greeting line: "*Daily News Digest*" followed by today's date
        |- For each article, use *bold* for the headline title
        |- Write 1-2 sentence summary for each article
        |- After each summary, include the original article URL on its own line so readers can tap to read more
        |- Keep the total digest concise and readable on a phone screen
        |- Use plain text formatting suitable for WhatsApp (no markdown links, just *bold* for emphasis and plain URLs)
        |- Number each article
        |- End with a sign-off line
        |
        |Here are the articles:
        |
        |$articleText
    """.trimMargin()

    private fun buildEconomistPrompt(articleText: String): String = """
        |You are a news digest assistant. Summarise the following articles from The Economist into a WhatsApp-friendly digest.
        |
        |Format rules:
        |- Start with a greeting line: "*The Economist Digest*" followed by today's date
        |- For each article, use *bold* for the headline title
        |- Write 1-2 sentence summary for each article
        |- After each summary, include the original article URL on its own line so readers can tap to read more
        |- Keep the total digest concise and readable on a phone screen
        |- Use plain text formatting suitable for WhatsApp (no markdown links, just *bold* for emphasis and plain URLs)
        |- Number each article
        |- End with a sign-off line
        |
        |Here are the articles:
        |
        |$articleText
    """.trimMargin()
}
