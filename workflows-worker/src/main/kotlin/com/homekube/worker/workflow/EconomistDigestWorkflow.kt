package com.homekube.worker.workflow

import com.homekube.worker.RecordDigestMetricsInput
import com.homekube.worker.SendNotificationInput
import com.homekube.worker.SummariseDigestInput
import io.temporal.activity.ActivityOptions
import io.temporal.common.RetryOptions
import io.temporal.workflow.Workflow
import io.temporal.workflow.WorkflowInterface
import io.temporal.workflow.WorkflowMethod
import java.time.Duration

@WorkflowInterface
interface EconomistDigestWorkflow {
    @WorkflowMethod
    fun execute(): String
}

class EconomistDigestWorkflowImpl : EconomistDigestWorkflow {

    private val log = Workflow.getLogger(EconomistDigestWorkflowImpl::class.java)

    private val retryOptions = RetryOptions.newBuilder()
        .setMaximumAttempts(3)
        .build()

    private val shortActivities = Workflow.newActivityStub(
        DigestActivities::class.java,
        ActivityOptions.newBuilder()
            .setStartToCloseTimeout(Duration.ofSeconds(30))
            .setRetryOptions(retryOptions)
            .build(),
    )

    private val fetchActivities = Workflow.newActivityStub(
        DigestActivities::class.java,
        ActivityOptions.newBuilder()
            .setStartToCloseTimeout(Duration.ofMinutes(2))
            .setRetryOptions(retryOptions)
            .build(),
    )

    private val summariseActivities = Workflow.newActivityStub(
        DigestActivities::class.java,
        ActivityOptions.newBuilder()
            .setStartToCloseTimeout(Duration.ofMinutes(5))
            .setRetryOptions(retryOptions)
            .build(),
    )

    override fun execute(): String {
        log.info("Starting Economist digest workflow")
        val startTime = Workflow.currentTimeMillis()

        try {
            val headlines = fetchActivities.fetchRssHeadlines("economist")
            log.info("Fetched ${headlines.size} Economist headlines")

            if (headlines.isEmpty()) {
                log.warn("No Economist headlines found, skipping digest")
                shortActivities.recordDigestMetrics(
                    RecordDigestMetricsInput(workflow = "economist", status = "success", durationMs = Workflow.currentTimeMillis() - startTime)
                )
                return "No headlines found"
            }

            val articles = fetchActivities.scrapeArticles(headlines, "economist")
            log.info("Scraped ${articles.size} Economist articles")

            if (articles.isEmpty()) {
                log.warn("No Economist articles scraped, skipping digest")
                shortActivities.recordDigestMetrics(
                    RecordDigestMetricsInput(workflow = "economist", status = "success", durationMs = Workflow.currentTimeMillis() - startTime)
                )
                return "No articles scraped"
            }

            val digest = summariseActivities.summariseDigest(
                SummariseDigestInput(articles = articles, digestType = "economist")
            )
            log.info("Generated Economist digest summary")

            val subscribers = shortActivities.getDigestSubscribers("economist")
            log.info("Found ${subscribers.size} Economist subscribers")

            if (subscribers.isEmpty()) {
                log.warn("No Economist subscribers, skipping delivery")
                shortActivities.recordDigestMetrics(
                    RecordDigestMetricsInput(
                        workflow = "economist", status = "success",
                        durationMs = Workflow.currentTimeMillis() - startTime,
                        articleCount = articles.size,
                    )
                )
                return "No subscribers"
            }

            shortActivities.sendDigestNotification(
                SendNotificationInput(
                    message = digest,
                    subscribers = subscribers,
                    workflow = "economist",
                    jobName = "economist-digest",
                )
            )
            log.info("Economist digest sent to ${subscribers.size} subscribers")

            shortActivities.recordDigestMetrics(
                RecordDigestMetricsInput(
                    workflow = "economist", status = "success",
                    durationMs = Workflow.currentTimeMillis() - startTime,
                    articleCount = articles.size,
                    subscriberCount = subscribers.size,
                )
            )
            return "Economist digest sent to ${subscribers.size} subscribers"
        } catch (e: Exception) {
            try {
                shortActivities.recordDigestMetrics(
                    RecordDigestMetricsInput(
                        workflow = "economist", status = "failure",
                        durationMs = Workflow.currentTimeMillis() - startTime,
                    )
                )
            } catch (recordErr: Exception) {
                log.error("Failed to record failure metrics", recordErr)
            }
            throw e
        }
    }
}
