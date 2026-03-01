package com.homekube.webscraper

import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.Id
import jakarta.persistence.Table
import org.hibernate.annotations.JdbcTypeCode
import org.hibernate.type.SqlTypes
import java.time.Instant
import java.util.UUID

// --- JPA Entities ---

@Entity
@Table(name = "scrape_jobs")
data class ScrapeJob(
    @Id
    val id: UUID = UUID.randomUUID(),

    @Column(name = "user_id", nullable = false)
    val userId: String = "",

    @Column(nullable = false)
    val name: String = "",

    @Column(name = "urls", columnDefinition = "text[]", nullable = false)
    @JdbcTypeCode(SqlTypes.ARRAY)
    val urls: Array<String> = emptyArray(),

    @Column(nullable = false)
    val instruction: String = "",

    @Column(name = "schedule_cron", nullable = false)
    val scheduleCron: String = "0 */3 * * *",

    @Column(nullable = false)
    val timezone: String = "Australia/Sydney",

    @Column(nullable = false)
    val enabled: Boolean = true,

    @Column(name = "created_at", nullable = false)
    val createdAt: Instant = Instant.now(),

    @Column(name = "updated_at", nullable = false)
    val updatedAt: Instant = Instant.now(),
)

@Entity
@Table(name = "scrape_runs")
data class ScrapeRun(
    @Id
    val id: UUID = UUID.randomUUID(),

    @Column(name = "job_id", nullable = false)
    val jobId: UUID = UUID.randomUUID(),

    @Column(nullable = false)
    val status: String = "running",

    @Column(name = "urls_scraped", nullable = false)
    val urlsScraped: Int = 0,

    @Column(nullable = false)
    val notified: Boolean = false,

    @Column(name = "claude_response")
    val claudeResponse: String? = null,

    val error: String? = null,

    @Column(name = "started_at", nullable = false)
    val startedAt: Instant = Instant.now(),

    @Column(name = "completed_at")
    val completedAt: Instant? = null,
)

// --- Request DTOs ---

data class CreateJobRequest(
    val name: String? = null,
    val urls: List<String>? = null,
    val instruction: String? = null,
    val schedule_cron: String? = null,
    val timezone: String? = null,
)

data class UpdateJobRequest(
    val name: String? = null,
    val urls: List<String>? = null,
    val instruction: String? = null,
    val schedule_cron: String? = null,
    val timezone: String? = null,
    val enabled: Boolean? = null,
)

// --- Response DTOs ---

data class JobResponse(val job: ScrapeJob)
data class JobListResponse(val jobs: List<ScrapeJob>)
data class RunListResponse(val runs: List<ScrapeRun>)
data class DeleteResponse(val deleted: Boolean = true)
data class TriggerResponse(val workflowId: String)

// --- Workflow/Activity DTOs ---

/** Workflow input DTO used by both schedule creation and manual trigger. */
data class WebScraperInput(val jobId: String)

/** Serialization-safe DTO for ScrapeJob (avoids sending JPA entities over the Temporal boundary). */
data class ScrapeJobDto(
    val id: String,
    val userId: String,
    val name: String,
    val urls: List<String>,
    val instruction: String,
    val scheduleCron: String,
    val timezone: String,
    val enabled: Boolean,
)

fun ScrapeJob.toDto() = ScrapeJobDto(
    id = id.toString(),
    userId = userId,
    name = name,
    urls = urls.toList(),
    instruction = instruction,
    scheduleCron = scheduleCron,
    timezone = timezone,
    enabled = enabled,
)

data class ScrapedContent(
    val url: String,
    val text: String,
)

data class AnalysisInput(
    val instruction: String,
    val scrapedContent: List<ScrapedContent>,
)

data class AnalysisResult(
    val shouldNotify: Boolean,
    val message: String,
)

data class Subscriber(
    val userId: String,
    val phone: String,
)

data class SendNotificationInput(
    val message: String,
    val subscribers: List<Subscriber>,
    val workflow: String,
    val jobName: String,
)

data class RecordRunInput(
    val jobId: String,
    val jobName: String,
    val status: String,
    val urlsScraped: Int,
    val notified: Boolean,
    val claudeResponse: String? = null,
    val error: String? = null,
    val durationMs: Long,
)
