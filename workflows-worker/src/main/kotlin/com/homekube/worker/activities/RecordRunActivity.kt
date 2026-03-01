package com.homekube.worker.activities

import com.homekube.worker.MetricsService
import com.homekube.worker.RecordRunInput
import com.homekube.worker.RunRepository
import com.homekube.worker.ScrapeRun
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
        log.infof("Recording run for job %s: status=%s", input.jobId, input.status)

        val run = ScrapeRun(
            jobId = UUID.fromString(input.jobId),
            status = input.status,
            urlsScraped = input.urlsScraped,
            notified = input.notified,
            claudeResponse = input.claudeResponse,
            error = input.error,
            completedAt = Instant.now(),
        )

        runRepository.insert(run)

        metricsService.recordRun(input.jobName, input.status, input.durationMs)
        metricsService.incrementUrlsScraped(input.jobName, input.urlsScraped)
    }
}
