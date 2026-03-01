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
interface NewsDigestWorkflow {
    @WorkflowMethod
    fun execute(): String
}

class NewsDigestWorkflowImpl : NewsDigestWorkflow {

    private val log = Workflow.getLogger(NewsDigestWorkflowImpl::class.java)

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
        log.info("Starting daily news digest workflow")
        val startTime = Workflow.currentTimeMillis()

        try {
            // 1. Fetch RSS headlines
            val headlines = fetchActivities.fetchRssHeadlines("news")
            log.info("Fetched ${headlines.size} headlines")

            if (headlines.isEmpty()) {
                log.warn("No headlines found, skipping digest")
                shortActivities.recordDigestMetrics(
                    RecordDigestMetricsInput(workflow = "news", status = "success", durationMs = Workflow.currentTimeMillis() - startTime)
                )
                return "No headlines found"
            }

            // 2. Scrape article text
            val articles = fetchActivities.scrapeArticles(headlines, "news")
            log.info("Scraped ${articles.size} articles")

            if (articles.isEmpty()) {
                log.warn("No articles scraped, skipping digest")
                shortActivities.recordDigestMetrics(
                    RecordDigestMetricsInput(workflow = "news", status = "success", durationMs = Workflow.currentTimeMillis() - startTime)
                )
                return "No articles scraped"
            }

            // 3. Summarise with Claude
            val digest = summariseActivities.summariseDigest(
                SummariseDigestInput(articles = articles, digestType = "news")
            )
            log.info("Generated digest summary")

            // 4. Get subscribers
            val subscribers = shortActivities.getDigestSubscribers("news")
            log.info("Found ${subscribers.size} subscribers")

            if (subscribers.isEmpty()) {
                log.warn("No subscribers, skipping delivery")
                shortActivities.recordDigestMetrics(
                    RecordDigestMetricsInput(
                        workflow = "news", status = "success",
                        durationMs = Workflow.currentTimeMillis() - startTime,
                        articleCount = articles.size,
                    )
                )
                return "No subscribers"
            }

            // 5. Send digest
            shortActivities.sendDigestNotification(
                SendNotificationInput(
                    message = digest,
                    subscribers = subscribers,
                    workflow = "news",
                    jobName = "daily-news-digest",
                )
            )
            log.info("Digest sent to ${subscribers.size} subscribers")

            shortActivities.recordDigestMetrics(
                RecordDigestMetricsInput(
                    workflow = "news", status = "success",
                    durationMs = Workflow.currentTimeMillis() - startTime,
                    articleCount = articles.size,
                    subscriberCount = subscribers.size,
                )
            )
            return "Digest sent to ${subscribers.size} subscribers"
        } catch (e: Exception) {
            try {
                shortActivities.recordDigestMetrics(
                    RecordDigestMetricsInput(
                        workflow = "news", status = "failure",
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
