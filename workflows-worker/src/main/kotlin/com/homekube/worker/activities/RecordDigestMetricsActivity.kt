package com.homekube.worker.activities

import com.homekube.worker.MetricsService
import com.homekube.worker.RecordDigestMetricsInput
import jakarta.enterprise.context.ApplicationScoped
import jakarta.inject.Inject
import org.jboss.logging.Logger

@ApplicationScoped
class RecordDigestMetricsActivity {

    private val log = Logger.getLogger(RecordDigestMetricsActivity::class.java)

    @Inject
    lateinit var metricsService: MetricsService

    fun execute(input: RecordDigestMetricsInput) {
        log.infof("Recording digest metrics: workflow=%s status=%s", input.workflow, input.status)
        metricsService.recordDigestRun(input.workflow, input.status, input.durationMs)
        if (input.articleCount > 0) {
            metricsService.incrementDigestArticles(input.workflow, input.articleCount)
        }
        if (input.subscriberCount > 0) {
            metricsService.incrementDigestMessagesSent(input.workflow, input.subscriberCount)
        }
    }
}
