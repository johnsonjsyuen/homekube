package com.homekube.worker.activities

import com.fasterxml.jackson.databind.ObjectMapper
import com.homekube.worker.MetricsService
import com.homekube.worker.NatsPublisher
import com.homekube.worker.SendNotificationInput
import jakarta.enterprise.context.ApplicationScoped
import jakarta.enterprise.context.control.ActivateRequestContext
import jakarta.inject.Inject
import org.jboss.logging.Logger
import java.time.Instant

@ApplicationScoped
class SendNotificationActivity {

    private val log = Logger.getLogger(SendNotificationActivity::class.java)

    @Inject
    lateinit var natsPublisher: NatsPublisher

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

                natsPublisher.publish("digests", messageValue)

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
