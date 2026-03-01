package com.homekube.webscraper.workflow

import com.homekube.webscraper.AnalysisInput
import com.homekube.webscraper.RecordRunInput
import com.homekube.webscraper.SendNotificationInput
import com.homekube.webscraper.WebScraperInput
import io.temporal.activity.ActivityOptions
import io.temporal.common.RetryOptions
import io.temporal.workflow.Workflow
import io.temporal.workflow.WorkflowInterface
import io.temporal.workflow.WorkflowMethod
import java.time.Duration

@WorkflowInterface
interface WebScraperWorkflow {
    @WorkflowMethod
    fun execute(input: WebScraperInput): String
}

class WebScraperWorkflowImpl : WebScraperWorkflow {

    private val log = Workflow.getLogger(WebScraperWorkflowImpl::class.java)

    private val retryOptions = RetryOptions.newBuilder()
        .setMaximumAttempts(3)
        .build()

    /** Activities with 30s timeout: loadJob, getJobSubscribers, sendNotification, recordRun */
    private val shortActivities = Workflow.newActivityStub(
        ScraperActivities::class.java,
        ActivityOptions.newBuilder()
            .setStartToCloseTimeout(Duration.ofSeconds(30))
            .setRetryOptions(retryOptions)
            .build(),
    )

    /** scrapeUrls: 2 minute timeout */
    private val scrapeActivities = Workflow.newActivityStub(
        ScraperActivities::class.java,
        ActivityOptions.newBuilder()
            .setStartToCloseTimeout(Duration.ofMinutes(2))
            .setRetryOptions(retryOptions)
            .build(),
    )

    /** analyseWithClaude: 3 minute timeout */
    private val analyseActivities = Workflow.newActivityStub(
        ScraperActivities::class.java,
        ActivityOptions.newBuilder()
            .setStartToCloseTimeout(Duration.ofMinutes(3))
            .setRetryOptions(retryOptions)
            .build(),
    )

    override fun execute(input: WebScraperInput): String {
        log.info("Starting web scraper workflow for jobId=${input.jobId}")
        val startTime = Workflow.currentTimeMillis()

        var jobName = "unknown"
        try {
            // 1. Load job config from DB
            val job = shortActivities.loadJob(input.jobId)
            jobName = job.name
            log.info("Loaded job: ${job.name}, urls: ${job.urls.size}")

            // 2. Scrape all configured URLs
            val scrapedContent = scrapeActivities.scrapeUrls(job.urls)
            log.info("Scraped ${scrapedContent.size}/${job.urls.size} URLs")

            if (scrapedContent.isEmpty()) {
                log.warn("All URLs failed to scrape, recording failure")
                shortActivities.recordRun(
                    RecordRunInput(
                        jobId = input.jobId,
                        jobName = job.name,
                        status = "failure",
                        urlsScraped = 0,
                        notified = false,
                        claudeResponse = null,
                        error = "All URLs failed to scrape",
                        durationMs = Workflow.currentTimeMillis() - startTime,
                    )
                )
                return "All URLs failed to scrape"
            }

            // 3. Send to Claude with the user's instruction
            val analysis = analyseActivities.analyseWithClaude(
                AnalysisInput(
                    instruction = job.instruction,
                    scrapedContent = scrapedContent,
                )
            )
            log.info("Claude analysis: shouldNotify=${analysis.shouldNotify}")

            // 4. If Claude decides to notify, send via Kafka
            var notified = false
            if (analysis.shouldNotify) {
                val subscribers = shortActivities.getJobSubscribers(job.userId)
                if (subscribers.isNotEmpty()) {
                    shortActivities.sendNotification(
                        SendNotificationInput(
                            message = analysis.message,
                            subscribers = subscribers,
                            workflow = "web-scraper",
                            jobName = job.name,
                        )
                    )
                    notified = true
                    log.info("Notification sent to ${subscribers.size} subscriber(s)")
                } else {
                    log.info("No WhatsApp sessions found for user, skipping notification")
                }
            }

            // 5. Record the run
            shortActivities.recordRun(
                RecordRunInput(
                    jobId = input.jobId,
                    jobName = job.name,
                    status = "success",
                    urlsScraped = scrapedContent.size,
                    notified = notified,
                    claudeResponse = analysis.message,
                    durationMs = Workflow.currentTimeMillis() - startTime,
                )
            )

            return if (analysis.shouldNotify) "Notification sent" else "No notification needed"
        } catch (e: Exception) {
            try {
                shortActivities.recordRun(
                    RecordRunInput(
                        jobId = input.jobId,
                        jobName = jobName,
                        status = "failure",
                        urlsScraped = 0,
                        notified = false,
                        claudeResponse = null,
                        error = e.toString(),
                        durationMs = Workflow.currentTimeMillis() - startTime,
                    )
                )
            } catch (recordErr: Exception) {
                log.error("Failed to record failure run", recordErr)
            }
            throw e
        }
    }
}
