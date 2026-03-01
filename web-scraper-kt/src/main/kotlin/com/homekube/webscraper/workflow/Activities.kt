package com.homekube.webscraper.workflow

import com.homekube.webscraper.AnalysisInput
import com.homekube.webscraper.AnalysisResult
import com.homekube.webscraper.RecordRunInput
import com.homekube.webscraper.ScrapedContent
import com.homekube.webscraper.ScrapeJobDto
import com.homekube.webscraper.SendNotificationInput
import com.homekube.webscraper.Subscriber
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
