package com.homekube.worker

import com.fasterxml.jackson.databind.PropertyNamingStrategies
import io.quarkus.runtime.annotations.RegisterForReflection
import java.time.Instant
import java.util.UUID

// Register Jackson SNAKE_CASE strategy for native image reflection
@RegisterForReflection(targets = [PropertyNamingStrategies.SnakeCaseStrategy::class])
class JacksonReflectionConfig

// --- Scrape Job DTOs (used for DB mapping and API responses) ---

@RegisterForReflection
data class ScrapeJob(
    val id: UUID = UUID.randomUUID(),
    val userId: String = "",
    val name: String = "",
    val urls: List<String> = emptyList(),
    val instruction: String = "",
    val scheduleCron: String = "0 */3 * * *",
    val timezone: String = "Australia/Sydney",
    val enabled: Boolean = true,
    val createdAt: Instant = Instant.now(),
    val updatedAt: Instant = Instant.now(),
)

@RegisterForReflection
data class ScrapeRun(
    val id: UUID = UUID.randomUUID(),
    val jobId: UUID = UUID.randomUUID(),
    val status: String = "running",
    val urlsScraped: Int = 0,
    val notified: Boolean = false,
    val claudeResponse: String? = null,
    val error: String? = null,
    val startedAt: Instant = Instant.now(),
    val completedAt: Instant? = null,
)

// --- Digest Subscription ---

@RegisterForReflection
data class DigestSubscription(
    val userId: String = "",
    val digestType: String = "",
    val subscribed: Boolean = true,
    val subscribedAt: Instant = Instant.now(),
    val updatedAt: Instant = Instant.now(),
)

// --- Request DTOs ---

@RegisterForReflection
data class CreateJobRequest(
    val name: String? = null,
    val urls: List<String>? = null,
    val instruction: String? = null,
    val schedule_cron: String? = null,
    val timezone: String? = null,
)

@RegisterForReflection
data class UpdateJobRequest(
    val name: String? = null,
    val urls: List<String>? = null,
    val instruction: String? = null,
    val schedule_cron: String? = null,
    val timezone: String? = null,
    val enabled: Boolean? = null,
)

// --- Response DTOs ---

@RegisterForReflection
data class JobResponse(val job: ScrapeJob)
@RegisterForReflection
data class JobListResponse(val jobs: List<ScrapeJob>)
@RegisterForReflection
data class RunListResponse(val runs: List<ScrapeRun>)
@RegisterForReflection
data class DeleteResponse(val deleted: Boolean = true)
@RegisterForReflection
data class TriggerResponse(val workflowId: String)
@RegisterForReflection
data class SubscriptionResponse(val subscribed: Boolean)
@RegisterForReflection
data class SubscriptionStatusResponse(val subscribed: Boolean)
@RegisterForReflection
data class DigestTriggerResponse(val workflowId: String, val message: String)

// --- Workflow/Activity DTOs ---

/** Workflow input DTO used by both schedule creation and manual trigger. */
@RegisterForReflection
data class WebScraperInput(val jobId: String = "")

/** Serialization-safe DTO for ScrapeJob (avoids sending complex types over the Temporal boundary). */
@RegisterForReflection
data class ScrapeJobDto(
    val id: String = "",
    val userId: String = "",
    val name: String = "",
    val urls: List<String> = emptyList(),
    val instruction: String = "",
    val scheduleCron: String = "",
    val timezone: String = "",
    val enabled: Boolean = false,
)

@RegisterForReflection
data class ScrapedContent(
    val url: String = "",
    val text: String = "",
)

@RegisterForReflection
data class AnalysisInput(
    val instruction: String = "",
    val scrapedContent: List<ScrapedContent> = emptyList(),
)

@RegisterForReflection
data class AnalysisResult(
    val shouldNotify: Boolean = false,
    val message: String = "",
)

@RegisterForReflection
data class Subscriber(
    val userId: String = "",
    val phone: String = "",
)

@RegisterForReflection
data class SendNotificationInput(
    val message: String = "",
    val subscribers: List<Subscriber> = emptyList(),
    val workflow: String = "",
    val jobName: String = "",
)

@RegisterForReflection
data class RecordRunInput(
    val jobId: String = "",
    val jobName: String = "",
    val status: String = "",
    val urlsScraped: Int = 0,
    val notified: Boolean = false,
    val claudeResponse: String? = null,
    val error: String? = null,
    val durationMs: Long = 0,
)

// --- Digest-specific DTOs ---

@RegisterForReflection
data class Headline(
    val title: String = "",
    val link: String = "",
    val pubDate: String = "",
    val description: String = "",
)

@RegisterForReflection
data class Article(
    val title: String = "",
    val link: String = "",
    val text: String = "",
)

@RegisterForReflection
data class SummariseDigestInput(
    val articles: List<Article> = emptyList(),
    val digestType: String = "",
)

@RegisterForReflection
data class RecordDigestMetricsInput(
    val workflow: String = "",
    val status: String = "",
    val durationMs: Long = 0,
    val articleCount: Int = 0,
    val subscriberCount: Int = 0,
)
