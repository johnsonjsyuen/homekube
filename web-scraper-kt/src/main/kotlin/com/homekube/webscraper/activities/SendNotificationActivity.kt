package com.homekube.webscraper.activities

import com.fasterxml.jackson.databind.ObjectMapper
import com.homekube.webscraper.MetricsService
import com.homekube.webscraper.SendNotificationInput
import io.smallrye.reactive.messaging.kafka.Record
import jakarta.enterprise.context.ApplicationScoped
import jakarta.enterprise.context.control.ActivateRequestContext
import jakarta.inject.Inject
import org.eclipse.microprofile.reactive.messaging.Channel
import org.eclipse.microprofile.reactive.messaging.Emitter
import org.jboss.logging.Logger
import java.time.Instant

@ApplicationScoped
class SendNotificationActivity {

    private val log = Logger.getLogger(SendNotificationActivity::class.java)

    @Inject
    @Channel("digests")
    lateinit var digestsEmitter: Emitter<Record<String, String>>

    @Inject
    lateinit var objectMapper: ObjectMapper

    @Inject
    lateinit var metricsService: MetricsService

    @ActivateRequestContext
    fun execute(input: SendNotificationInput) {
        val failures = mutableListOf<String>()

        for (subscriber in input.subscribers) {
            try {
                val messageValue = objectMapper.writeValueAsString(
                    mapOf(
                        "userId" to subscriber.userId,
                        "recipientPhone" to subscriber.phone,
                        "message" to input.message,
                        "workflow" to input.workflow,
                        "timestamp" to Instant.now().toString(),
                    )
                )

                // Send to Kafka with subscriber userId as key
                val record = Record.of(subscriber.userId, messageValue)
                digestsEmitter.send(record).toCompletableFuture().get()

                log.infof("[Send] Produced notification for %s", subscriber.phone)
                metricsService.incrementNotificationsSent(input.jobName)
            } catch (e: Exception) {
                log.errorf("[Send] Error producing notification for %s: %s", subscriber.phone, e.message)
                failures.add(subscriber.phone)
            }
        }

        if (failures.isNotEmpty()) {
            throw RuntimeException(
                "Failed to produce notification for ${failures.size} subscriber(s): ${failures.joinToString(", ")}"
            )
        }
    }
}
