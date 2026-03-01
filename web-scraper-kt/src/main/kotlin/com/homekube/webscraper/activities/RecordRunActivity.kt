package com.homekube.webscraper.activities

import com.homekube.webscraper.MetricsService
import com.homekube.webscraper.RecordRunInput
import com.homekube.webscraper.RunRepository
import com.homekube.webscraper.ScrapeRun
import io.quarkus.narayana.jta.QuarkusTransaction
import jakarta.enterprise.context.ApplicationScoped
import jakarta.enterprise.context.control.ActivateRequestContext
import jakarta.inject.Inject
import org.jboss.logging.Logger
import java.time.Instant
import java.util.UUID

@ApplicationScoped
class RecordRunActivity {

    private val log = Logger.getLogger(RecordRunActivity::class.java)

    @Inject
    lateinit var runRepository: RunRepository

    @Inject
    lateinit var metricsService: MetricsService

    @ActivateRequestContext
    fun execute(input: RecordRunInput) {
        log.infof("Recording run for job %s: status=%s, urls=%d", input.jobId, input.status, input.urlsScraped)

        QuarkusTransaction.requiringNew().run {
            val run = ScrapeRun(
                jobId = UUID.fromString(input.jobId),
                status = input.status,
                urlsScraped = input.urlsScraped,
                notified = input.notified,
                claudeResponse = input.claudeResponse,
                error = input.error,
                completedAt = Instant.now(),
            )

            runRepository.persist(run)
        }

        // Update Prometheus metrics (outside transaction)
        metricsService.recordRun(input.jobName, input.status, input.durationMs)
        metricsService.incrementUrlsScraped(input.jobName, input.urlsScraped)
    }
}
