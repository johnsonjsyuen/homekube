package com.homekube.worker.workflow

import com.homekube.worker.Article
import com.homekube.worker.Headline
import com.homekube.worker.RecordDigestMetricsInput
import com.homekube.worker.SendNotificationInput
import com.homekube.worker.Subscriber
import com.homekube.worker.SummariseDigestInput
import io.temporal.activity.ActivityInterface
import io.temporal.activity.ActivityMethod

@ActivityInterface
interface DigestActivities {

    @ActivityMethod
    fun fetchRssHeadlines(digestType: String): List<Headline>

    @ActivityMethod
    fun scrapeArticles(headlines: List<Headline>, digestType: String): List<Article>

    @ActivityMethod
    fun summariseDigest(input: SummariseDigestInput): String

    @ActivityMethod
    fun getDigestSubscribers(digestType: String): List<Subscriber>

    @ActivityMethod
    fun sendDigestNotification(input: SendNotificationInput)

    @ActivityMethod
    fun recordDigestMetrics(input: RecordDigestMetricsInput)
}
