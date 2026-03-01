package com.homekube.worker

import jakarta.enterprise.context.ApplicationScoped
import jakarta.inject.Inject
import org.jooq.DSLContext
import org.jooq.impl.DSL.*
import org.jooq.impl.SQLDataType
import java.time.OffsetDateTime
import java.util.UUID

@ApplicationScoped
class JobRepository {

    @Inject
    lateinit var dsl: DSLContext

    companion object {
        val SCRAPE_JOBS = table("scrape_jobs")
        val ID = field("id", SQLDataType.UUID)
        val USER_ID = field("user_id", SQLDataType.VARCHAR)
        val NAME = field("name", SQLDataType.VARCHAR)
        val URLS = field("urls", SQLDataType.VARCHAR.array())
        val INSTRUCTION = field("instruction", SQLDataType.VARCHAR)
        val SCHEDULE_CRON = field("schedule_cron", SQLDataType.VARCHAR)
        val TIMEZONE = field("timezone", SQLDataType.VARCHAR)
        val ENABLED = field("enabled", SQLDataType.BOOLEAN)
        val CREATED_AT = field("created_at", SQLDataType.TIMESTAMPWITHTIMEZONE)
        val UPDATED_AT = field("updated_at", SQLDataType.TIMESTAMPWITHTIMEZONE)
    }

    private fun mapToScrapeJob(r: org.jooq.Record): ScrapeJob = ScrapeJob(
        id = r.get(ID)!!,
        userId = r.get(USER_ID) ?: "",
        name = r.get(NAME) ?: "",
        urls = (r.get(URLS) ?: emptyArray()).toList(),
        instruction = r.get(INSTRUCTION) ?: "",
        scheduleCron = r.get(SCHEDULE_CRON) ?: "0 */3 * * *",
        timezone = r.get(TIMEZONE) ?: "Australia/Sydney",
        enabled = r.get(ENABLED) ?: true,
        createdAt = (r.get(CREATED_AT) as? OffsetDateTime)?.toInstant() ?: java.time.Instant.now(),
        updatedAt = (r.get(UPDATED_AT) as? OffsetDateTime)?.toInstant() ?: java.time.Instant.now(),
    )

    fun findByUserId(userId: String): List<ScrapeJob> =
        dsl.select().from(SCRAPE_JOBS)
            .where(USER_ID.eq(userId))
            .orderBy(CREATED_AT.desc())
            .fetch()
            .map(::mapToScrapeJob)

    fun findById(id: UUID): ScrapeJob? =
        dsl.select().from(SCRAPE_JOBS)
            .where(ID.eq(id))
            .fetchOne()
            ?.let(::mapToScrapeJob)

    fun findByIdAndUserId(id: UUID, userId: String): ScrapeJob? =
        dsl.select().from(SCRAPE_JOBS)
            .where(ID.eq(id).and(USER_ID.eq(userId)))
            .fetchOne()
            ?.let(::mapToScrapeJob)

    fun countByUserId(userId: String): Long =
        dsl.selectCount().from(SCRAPE_JOBS)
            .where(USER_ID.eq(userId))
            .fetchOne(0, Long::class.java) ?: 0L

    fun countEnabled(): Long =
        dsl.selectCount().from(SCRAPE_JOBS)
            .where(ENABLED.isTrue)
            .fetchOne(0, Long::class.java) ?: 0L

    fun insert(job: ScrapeJob) {
        dsl.insertInto(SCRAPE_JOBS)
            .set(ID, job.id)
            .set(USER_ID, job.userId)
            .set(NAME, job.name)
            .set(URLS, job.urls.toTypedArray())
            .set(INSTRUCTION, job.instruction)
            .set(SCHEDULE_CRON, job.scheduleCron)
            .set(TIMEZONE, job.timezone)
            .set(ENABLED, job.enabled)
            .set(CREATED_AT, OffsetDateTime.now())
            .set(UPDATED_AT, OffsetDateTime.now())
            .execute()
    }

    fun update(job: ScrapeJob) {
        dsl.update(SCRAPE_JOBS)
            .set(NAME, job.name)
            .set(URLS, job.urls.toTypedArray())
            .set(INSTRUCTION, job.instruction)
            .set(SCHEDULE_CRON, job.scheduleCron)
            .set(TIMEZONE, job.timezone)
            .set(ENABLED, job.enabled)
            .set(UPDATED_AT, OffsetDateTime.now())
            .where(ID.eq(job.id))
            .execute()
    }

    fun deleteByIdAndUserId(id: UUID, userId: String): Int =
        dsl.deleteFrom(SCRAPE_JOBS)
            .where(ID.eq(id).and(USER_ID.eq(userId)))
            .execute()
}
