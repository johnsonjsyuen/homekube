package com.homekube.worker.workflow

import com.homekube.worker.AnalysisInput
import com.homekube.worker.AnalysisResult
import com.homekube.worker.RecordRunInput
import com.homekube.worker.ScrapedContent
import com.homekube.worker.ScrapeJobDto
import com.homekube.worker.SendNotificationInput
import com.homekube.worker.Subscriber
import io.temporal.activity.ActivityInterface
import io.temporal.activity.ActivityMethod

@ActivityInterface
interface ScraperActivities {

    @ActivityMethod
    fun loadJob(jobId: String): ScrapeJobDto

    @ActivityMethod
    fun scrapeUrls(urls: List<String>): List<ScrapedContent>

    @ActivityMethod
    fun analyseWithClaude(input: AnalysisInput): AnalysisResult

    @ActivityMethod
    fun getJobSubscribers(userId: String): List<Subscriber>

    @ActivityMethod
    fun sendNotification(input: SendNotificationInput)

    @ActivityMethod
    fun recordRun(input: RecordRunInput)
}
