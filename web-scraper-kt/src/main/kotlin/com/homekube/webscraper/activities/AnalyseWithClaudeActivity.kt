package com.homekube.webscraper.activities

import com.fasterxml.jackson.databind.ObjectMapper
import com.homekube.webscraper.AnalysisInput
import com.homekube.webscraper.AnalysisResult
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
class AnalyseWithClaudeActivity {

    private val log = Logger.getLogger(AnalyseWithClaudeActivity::class.java)

    @ConfigProperty(name = "app.claude-api.url")
    lateinit var claudeApiUrl: String

    @Inject
    lateinit var objectMapper: ObjectMapper

    companion object {
        private val JSON_PATTERN = Regex("""\{[\s\S]*"shouldNotify"[\s\S]*\}""")
    }

    private val httpClient: HttpClient = HttpClient.newBuilder()
        .connectTimeout(Duration.ofSeconds(30))
        .build()

    fun execute(input: AnalysisInput): AnalysisResult {
        // Build the prompt (identical to TypeScript template)
        val contentText = input.scrapedContent.joinToString("\n\n") { c ->
            "--- URL: ${c.url} ---\n${c.text}"
        }

        val prompt = """
            |You are a web monitoring assistant. The user has configured a monitoring job with this instruction:
            |
            |"${input.instruction}"
            |
            |Below is the content scraped from the monitored URLs:
            |
            |$contentText
            |
            |Analyze the scraped content against the user's instruction. Respond in this exact JSON format:
            |{"shouldNotify": true/false, "message": "WhatsApp message if notifying, or brief status if not"}
            |
            |Rules:
            |- Set shouldNotify to true ONLY if the content matches what the user asked to be alerted about
            |- If notifying, write a concise WhatsApp-friendly message using *bold* for emphasis
            |- If not notifying, set message to a brief status like "No matching content found"
            |- Do not hallucinate or invent information not present in the scraped content
        """.trimMargin()

        // Build the request body
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

        // Parse the response JSON to extract the "response" field
        return try {
            val responseJson = objectMapper.readTree(responseBody)
            val claudeText = responseJson.get("response")?.asText() ?: responseBody

            // Extract JSON from Claude's response
            val jsonMatch = JSON_PATTERN.find(claudeText)
            if (jsonMatch == null) {
                log.warnf("[Claude] No JSON found in response, defaulting to no-notify: %s",
                    claudeText.take(200))
                return AnalysisResult(shouldNotify = false, message = "Parse error: no JSON in response")
            }

            val parsed = objectMapper.readTree(jsonMatch.value)
            AnalysisResult(
                shouldNotify = parsed.get("shouldNotify")?.asBoolean() ?: false,
                message = parsed.get("message")?.asText() ?: "",
            )
        } catch (e: Exception) {
            log.warnf("[Claude] Failed to parse JSON response, defaulting to no-notify: %s",
                responseBody.take(200))
            AnalysisResult(shouldNotify = false, message = "Parse error: no JSON in response")
        }
    }
}
