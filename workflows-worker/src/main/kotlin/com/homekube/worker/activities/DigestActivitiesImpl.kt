package com.homekube.worker.activities

import com.homekube.worker.Article
import com.homekube.worker.Headline
import com.homekube.worker.RecordDigestMetricsInput
import com.homekube.worker.SendNotificationInput
import com.homekube.worker.Subscriber
import com.homekube.worker.SummariseDigestInput
import com.homekube.worker.workflow.DigestActivities
import jakarta.enterprise.context.ApplicationScoped
import jakarta.inject.Inject

@ApplicationScoped
class DigestActivitiesImpl : DigestActivities {

    @Inject lateinit var fetchRssActivity: FetchRssActivity
    @Inject lateinit var scrapeArticlesActivity: ScrapeArticlesActivity
    @Inject lateinit var summariseDigestActivity: SummariseDigestActivity
    @Inject lateinit var getDigestSubscribersActivity: GetDigestSubscribersActivity
    @Inject lateinit var sendNotificationActivity: SendNotificationActivity
    @Inject lateinit var recordDigestMetricsActivity: RecordDigestMetricsActivity

    override fun fetchRssHeadlines(digestType: String): List<Headline> = fetchRssActivity.execute(digestType)
    override fun scrapeArticles(headlines: List<Headline>, digestType: String): List<Article> = scrapeArticlesActivity.execute(headlines, digestType)
    override fun summariseDigest(input: SummariseDigestInput): String = summariseDigestActivity.execute(input)
    override fun getDigestSubscribers(digestType: String): List<Subscriber> = getDigestSubscribersActivity.execute(digestType)
    override fun sendDigestNotification(input: SendNotificationInput) = sendNotificationActivity.execute(input)
    override fun recordDigestMetrics(input: RecordDigestMetricsInput) = recordDigestMetricsActivity.execute(input)
}
