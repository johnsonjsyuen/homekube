package com.homekube.webscraper

import io.micrometer.core.instrument.MeterRegistry
import jakarta.enterprise.context.ApplicationScoped
import java.time.Duration
import java.util.concurrent.atomic.AtomicLong

@ApplicationScoped
class MetricsService(private val registry: MeterRegistry) {

    private val activeJobsValue = AtomicLong(0)

    init {
        registry.gauge("scraper_active_jobs", activeJobsValue) { it.toDouble() }
    }

    fun recordRun(jobName: String, status: String, durationMs: Long) {
        registry.counter("scraper_runs_total", "job_name", jobName, "status", status).increment()
        registry.timer("scraper_run_duration_seconds", "job_name", jobName)
            .record(Duration.ofMillis(durationMs))
    }

    fun incrementUrlsScraped(jobName: String, count: Int) {
        registry.counter("scraper_urls_scraped_total", "job_name", jobName).increment(count.toDouble())
    }

    fun incrementNotificationsSent(jobName: String) {
        registry.counter("scraper_notifications_sent_total", "job_name", jobName).increment()
    }

    fun updateActiveJobs(count: Long) {
        activeJobsValue.set(count)
    }
}
