package com.homekube.worker.activities

import com.homekube.worker.AnalysisInput
import com.homekube.worker.AnalysisResult
import com.homekube.worker.RecordRunInput
import com.homekube.worker.ScrapedContent
import com.homekube.worker.ScrapeJobDto
import com.homekube.worker.SendNotificationInput
import com.homekube.worker.Subscriber
import com.homekube.worker.workflow.ScraperActivities
import jakarta.enterprise.context.ApplicationScoped
import jakarta.inject.Inject

@ApplicationScoped
class ScraperActivitiesImpl : ScraperActivities {

    @Inject lateinit var loadJobActivity: LoadJobActivity
    @Inject lateinit var scrapeUrlsActivity: ScrapeUrlsActivity
    @Inject lateinit var analyseWithClaudeActivity: AnalyseWithClaudeActivity
    @Inject lateinit var getJobSubscribersActivity: GetJobSubscribersActivity
    @Inject lateinit var sendNotificationActivity: SendNotificationActivity
    @Inject lateinit var recordRunActivity: RecordRunActivity

    override fun loadJob(jobId: String): ScrapeJobDto = loadJobActivity.execute(jobId)
    override fun scrapeUrls(urls: List<String>): List<ScrapedContent> = scrapeUrlsActivity.execute(urls)
    override fun analyseWithClaude(input: AnalysisInput): AnalysisResult = analyseWithClaudeActivity.execute(input)
    override fun getJobSubscribers(userId: String): List<Subscriber> = getJobSubscribersActivity.execute(userId)
    override fun sendNotification(input: SendNotificationInput) = sendNotificationActivity.execute(input)
    override fun recordRun(input: RecordRunInput) = recordRunActivity.execute(input)
}
