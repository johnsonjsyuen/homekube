package com.homekube.webscraper.activities

import com.homekube.webscraper.JobRepository
import com.homekube.webscraper.ScrapeJobDto
import com.homekube.webscraper.toDto
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
        log.infof("Loading job %s", jobId)

        val uuid = try {
            UUID.fromString(jobId)
        } catch (e: IllegalArgumentException) {
            throw ApplicationFailure.newFailure("Invalid job ID: $jobId", "INVALID_JOB_ID")
        }

        val job = jobRepository.findById(uuid)
            ?: throw ApplicationFailure.newFailure("Job not found: $jobId", "JOB_NOT_FOUND")

        return job.toDto()
    }
}
