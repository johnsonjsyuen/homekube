package com.homekube.worker.activities

import com.homekube.worker.JobRepository
import com.homekube.worker.ScrapeJobDto
import io.temporal.failure.ApplicationFailure
import jakarta.enterprise.context.ApplicationScoped
import jakarta.enterprise.context.control.ActivateRequestContext
import jakarta.inject.Inject
import org.jboss.logging.Logger
import java.util.UUID

@ApplicationScoped
class LoadJobActivity {

    private val log = Logger.getLogger(LoadJobActivity::class.java)

    @Inject
    lateinit var jobRepository: JobRepository

    @ActivateRequestContext
    fun execute(jobId: String): ScrapeJobDto {
        val uuid = try {
            UUID.fromString(jobId)
        } catch (e: IllegalArgumentException) {
            throw ApplicationFailure.newFailure("Invalid job ID: $jobId", "INVALID_JOB_ID")
        }

        val job = jobRepository.findById(uuid)
            ?: throw ApplicationFailure.newFailure("Job not found: $jobId", "JOB_NOT_FOUND")

        log.infof("Loaded job %s: %s", jobId, job.name)

        return ScrapeJobDto(
            id = job.id.toString(),
            userId = job.userId,
            name = job.name,
            urls = job.urls,
            instruction = job.instruction,
            scheduleCron = job.scheduleCron,
            timezone = job.timezone,
            enabled = job.enabled,
        )
    }
}
