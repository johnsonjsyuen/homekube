package com.homekube.webscraper.activities

import com.homekube.webscraper.AnalysisInput
import com.homekube.webscraper.AnalysisResult
import com.homekube.webscraper.RecordRunInput
import com.homekube.webscraper.ScrapedContent
import com.homekube.webscraper.ScrapeJobDto
import com.homekube.webscraper.SendNotificationInput
import com.homekube.webscraper.Subscriber
import com.homekube.webscraper.workflow.ScraperActivities
import jakarta.enterprise.context.ApplicationScoped
import jakarta.inject.Inject

/**
 * Bridges the Temporal [ScraperActivities] interface with the individual
 * CDI-managed activity beans. Each method delegates to the corresponding
 * activity class so that those classes can inject Quarkus-managed resources
 * (repositories, config, HTTP clients, etc.).
 */
@ApplicationScoped
class ScraperActivitiesImpl : ScraperActivities {

    @Inject
    lateinit var loadJobActivity: LoadJobActivity

    @Inject
    lateinit var scrapeUrlsActivity: ScrapeUrlsActivity

    @Inject
    lateinit var analyseWithClaudeActivity: AnalyseWithClaudeActivity

    @Inject
    lateinit var getJobSubscribersActivity: GetJobSubscribersActivity

    @Inject
    lateinit var sendNotificationActivity: SendNotificationActivity

    @Inject
    lateinit var recordRunActivity: RecordRunActivity

    override fun loadJob(jobId: String): ScrapeJobDto =
        loadJobActivity.execute(jobId)

    override fun scrapeUrls(urls: List<String>): List<ScrapedContent> =
        scrapeUrlsActivity.execute(urls)

    override fun analyseWithClaude(input: AnalysisInput): AnalysisResult =
        analyseWithClaudeActivity.execute(input)

    override fun getJobSubscribers(userId: String): List<Subscriber> =
        getJobSubscribersActivity.execute(userId)

    override fun sendNotification(input: SendNotificationInput) =
        sendNotificationActivity.execute(input)

    override fun recordRun(input: RecordRunInput) =
        recordRunActivity.execute(input)
}
