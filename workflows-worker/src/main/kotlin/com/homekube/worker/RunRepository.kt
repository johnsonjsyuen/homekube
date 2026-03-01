package com.homekube.worker

import jakarta.enterprise.context.ApplicationScoped
import jakarta.inject.Inject
import org.jooq.DSLContext
import org.jooq.impl.DSL.*
import org.jooq.impl.SQLDataType
import java.time.OffsetDateTime
import java.util.UUID

@ApplicationScoped
class RunRepository {

    @Inject
    lateinit var dsl: DSLContext

    companion object {
        val SCRAPE_RUNS = table("scrape_runs")
        val ID = field("id", SQLDataType.UUID)
        val JOB_ID = field("job_id", SQLDataType.UUID)
        val STATUS = field("status", SQLDataType.VARCHAR)
        val URLS_SCRAPED = field("urls_scraped", SQLDataType.INTEGER)
        val NOTIFIED = field("notified", SQLDataType.BOOLEAN)
        val CLAUDE_RESPONSE = field("claude_response", SQLDataType.VARCHAR)
        val ERROR = field("error", SQLDataType.VARCHAR)
        val STARTED_AT = field("started_at", SQLDataType.TIMESTAMPWITHTIMEZONE)
        val COMPLETED_AT = field("completed_at", SQLDataType.TIMESTAMPWITHTIMEZONE)
    }

    private fun mapToScrapeRun(r: org.jooq.Record): ScrapeRun = ScrapeRun(
        id = r.get(ID)!!,
        jobId = r.get(JOB_ID)!!,
        status = r.get(STATUS) ?: "running",
        urlsScraped = r.get(URLS_SCRAPED) ?: 0,
        notified = r.get(NOTIFIED) ?: false,
        claudeResponse = r.get(CLAUDE_RESPONSE),
        error = r.get(ERROR),
        startedAt = (r.get(STARTED_AT) as? OffsetDateTime)?.toInstant() ?: java.time.Instant.now(),
        completedAt = (r.get(COMPLETED_AT) as? OffsetDateTime)?.toInstant(),
    )

    fun findByJobId(jobId: UUID, limit: Int): List<ScrapeRun> =
        dsl.select().from(SCRAPE_RUNS)
            .where(JOB_ID.eq(jobId))
            .orderBy(STARTED_AT.desc())
            .limit(limit)
            .fetch()
            .map(::mapToScrapeRun)

    fun insert(run: ScrapeRun) {
        dsl.insertInto(SCRAPE_RUNS)
            .set(ID, run.id)
            .set(JOB_ID, run.jobId)
            .set(STATUS, run.status)
            .set(URLS_SCRAPED, run.urlsScraped)
            .set(NOTIFIED, run.notified)
            .set(CLAUDE_RESPONSE, run.claudeResponse)
            .set(ERROR, run.error)
            .set(STARTED_AT, OffsetDateTime.now())
            .set(COMPLETED_AT, run.completedAt?.let { OffsetDateTime.ofInstant(it, java.time.ZoneOffset.UTC) })
            .execute()
    }
}
