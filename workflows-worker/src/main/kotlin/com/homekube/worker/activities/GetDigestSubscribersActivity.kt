package com.homekube.worker.activities

import com.fasterxml.jackson.databind.ObjectMapper
import com.homekube.worker.DigestSubscriptionRepository
import com.homekube.worker.Subscriber
import io.quarkus.oidc.client.OidcClient
import jakarta.enterprise.context.ApplicationScoped
import jakarta.enterprise.context.control.ActivateRequestContext
import jakarta.inject.Inject
import org.eclipse.microprofile.config.inject.ConfigProperty
import org.jboss.logging.Logger
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.time.Duration

@ApplicationScoped
class GetDigestSubscribersActivity {

    private val log = Logger.getLogger(GetDigestSubscribersActivity::class.java)

    @ConfigProperty(name = "app.whatsapp.url")
    lateinit var whatsappUrl: String

    @Inject
    lateinit var oidcClient: OidcClient

    @Inject
    lateinit var objectMapper: ObjectMapper

    @Inject
    lateinit var digestSubscriptionRepository: DigestSubscriptionRepository

    private val httpClient: HttpClient = HttpClient.newBuilder()
        .version(HttpClient.Version.HTTP_1_1)
        .connectTimeout(Duration.ofSeconds(15))
        .build()

    @ActivateRequestContext
    fun execute(digestType: String): List<Subscriber> {
        // 1. Get active subscriber user IDs from DB
        val userIds = digestSubscriptionRepository.findActiveUserIdsByType(digestType)
        log.infof("[Digest] Found %d active %s subscriptions", userIds.size, digestType)

        if (userIds.isEmpty()) {
            return emptyList()
        }

        // 2. Look up WhatsApp sessions
        val tokens = oidcClient.tokens.await().indefinitely()
        val accessToken = tokens.accessToken

        val requestBody = objectMapper.writeValueAsString(
            mapOf("userIds" to userIds)
        )

        val request = HttpRequest.newBuilder()
            .uri(URI.create("$whatsappUrl/api/sessions/lookup"))
            .timeout(Duration.ofSeconds(30))
            .header("Authorization", "Bearer $accessToken")
            .header("Content-Type", "application/json")
            .POST(HttpRequest.BodyPublishers.ofString(requestBody))
            .build()

        val response = httpClient.send(request, HttpResponse.BodyHandlers.ofString())

        if (response.statusCode() !in 200..299) {
            throw RuntimeException("Sessions lookup failed: HTTP ${response.statusCode()} ${response.body()}")
        }

        val responseJson = objectMapper.readTree(response.body())
        val sessions = responseJson.get("sessions") ?: return emptyList()

        return sessions.map { node ->
            Subscriber(
                userId = node.get("userId").asText(),
                phone = node.get("phone").asText(),
            )
        }
    }
}
